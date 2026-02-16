import { expect, Page, test } from '@playwright/test'

type Who = 'caller' | 'callee'
const OTHER: Record<Who, Who> = { caller: 'callee', callee: 'caller' }

const READY_TIMEOUT_MS = 15_000
const RECOVERY_SLA_MS = 8_000

function captureConsole(page: Page, tag: string) {
    page.on('console', (msg) => {
        // eslint-disable-next-line no-console
        console.log(`[${tag}][${msg.type()}]`, msg.text())
    })
    page.on('pageerror', (err) => {
        // eslint-disable-next-line no-console
        console.error(`[${tag}][pageerror]`, err)
    })
}

async function waitAppReady(page: Page) {
    await page.waitForFunction(() => !!(window as any).app)
}

async function waitRoleReadyNoAssist(page: Page, who: Who, timeoutMs = READY_TIMEOUT_MS) {
    const startedAt = Date.now()
    await page.evaluate(async ({ who, timeoutMs }) => {
        const obj = (window as any)[who]
        if (!obj) throw new Error(`Role object is missing: ${who}`)
        await obj.waitReadyNoAssist(timeoutMs)
    }, { who, timeoutMs })
    return Date.now() - startedAt
}

async function assertStateConnected(page: Page, who: Who) {
    const st = await page.evaluate((w) => (window as any)[w].getState(), who)
    expect(st.pcState, `${who} pcState`).toBe('connected')
    expect(st.fast?.state, `${who} fast channel`).toBe('open')
    expect(st.reliable?.state, `${who} reliable channel`).toBe('open')
}

async function assertPingStrict(from: Page, whoFrom: Who, to: Page, expectedText: string) {
    if (whoFrom === 'caller') {
        await from.evaluate(async (t) => { await (window as any).caller.sendReliable(t) }, expectedText)
        await expect
            .poll(async () => {
                const got = await to.evaluate(() => (window as any).callee.takeMessages())
                return got.includes(expectedText)
            }, { timeout: 5_000, intervals: [100] })
            .toBe(true)
        return
    }

    await from.evaluate(async (t) => { await (window as any).callee.sendReliable(t) }, expectedText)
    await expect
        .poll(async () => {
            const got = await to.evaluate(() => (window as any).caller.takeMessages())
            return got.includes(expectedText)
        }, { timeout: 5_000, intervals: [100] })
        .toBe(true)
}

async function bootPair(pCaller: Page, pCallee: Page, baseURL: string) {
    captureConsole(pCaller, 'caller')
    captureConsole(pCallee, 'callee')

    await pCaller.goto(`${baseURL}/e2e-rtc.html`)
    await pCallee.goto(`${baseURL}/e2e-rtc.html`)
    await Promise.all([waitAppReady(pCaller), waitAppReady(pCallee)])

    const roomId = await pCaller.evaluate(async () => {
        ;(window as any).caller = await (window as any).app.makeCaller()
        return await (window as any).caller.hostRoom()
    })

    await pCallee.evaluate(async (rid) => {
        ;(window as any).callee = await (window as any).app.makeCallee()
        await (window as any).callee.joinRoom(rid)
    }, roomId)

    await Promise.all([
        waitRoleReadyNoAssist(pCaller, 'caller'),
        waitRoleReadyNoAssist(pCallee, 'callee'),
    ])

    await assertStateConnected(pCaller, 'caller')
    await assertStateConnected(pCallee, 'callee')

    await assertPingStrict(pCaller, 'caller', pCallee, 'sanity-from-caller')
    await assertPingStrict(pCallee, 'callee', pCaller, 'sanity-from-callee')
    return roomId
}

async function reloadRoleStrict(page: Page, who: Who, roomId: string) {
    await page.reload()
    await waitAppReady(page)

    await page.evaluate(async ({ who, roomId }) => {
        if (who === 'caller') {
            ;(window as any).caller = await (window as any).app.makeCaller()
            await (window as any).caller.joinRoom(roomId)
            return
        }
        ;(window as any).callee = await (window as any).app.makeCallee()
        await (window as any).callee.joinRoom(roomId)
    }, { who, roomId })

    return await waitRoleReadyNoAssist(page, who)
}

async function cleanupPair(pCaller: Page, pCallee: Page) {
    for (const [page, who] of [
        [pCaller, 'caller'],
        [pCallee, 'callee'],
    ] as const) {
        try {
            await page.evaluate(async (w) => {
                const obj = (window as any)[w]
                if (!obj?.endRoom) return
                await obj.endRoom()
            }, who)
        } catch {}
    }
}

test.describe('reload recovery (strict no-assist)', () => {
    test.setTimeout(120_000)

    let pCaller: Page
    let pCallee: Page
    let roomId: string

    test.beforeEach(async ({ context, baseURL }) => {
        pCaller = await context.newPage()
        pCallee = await context.newPage()
        roomId = await bootPair(pCaller, pCallee, baseURL!)
    })

    test.afterEach(async () => {
        await cleanupPair(pCaller, pCallee)
    })

    test('caller reload recovers within SLA and message flow survives', async () => {
        const elapsedMs = await reloadRoleStrict(pCaller, 'caller', roomId)
        expect(elapsedMs, `caller recovery must be <= ${RECOVERY_SLA_MS}ms`).toBeLessThanOrEqual(RECOVERY_SLA_MS)

        await waitRoleReadyNoAssist(pCallee, 'callee')
        await assertStateConnected(pCaller, 'caller')
        await assertStateConnected(pCallee, 'callee')

        await assertPingStrict(pCaller, 'caller', pCallee, 'after-caller-reload')
        await assertPingStrict(pCallee, 'callee', pCaller, 'pong-after-caller-reload')
    })

    test('callee reload recovers within SLA and message flow survives', async () => {
        const elapsedMs = await reloadRoleStrict(pCallee, 'callee', roomId)
        expect(elapsedMs, `callee recovery must be <= ${RECOVERY_SLA_MS}ms`).toBeLessThanOrEqual(RECOVERY_SLA_MS)

        await waitRoleReadyNoAssist(pCaller, 'caller')
        await assertStateConnected(pCaller, 'caller')
        await assertStateConnected(pCallee, 'callee')

        await assertPingStrict(pCaller, 'caller', pCallee, 'after-callee-reload')
        await assertPingStrict(pCallee, 'callee', pCaller, 'pong-after-callee-reload')
    })

    test('alternating reloads preserve recovery for both sides', async () => {
        const seq: Who[] = ['caller', 'callee', 'caller', 'callee']

        let step = 0
        for (const who of seq) {
            step++
            const reloaded = who === 'caller' ? pCaller : pCallee
            const other = who === 'caller' ? pCallee : pCaller

            const elapsedMs = await reloadRoleStrict(reloaded, who, roomId)
            expect(elapsedMs, `${who} recovery at step ${step} must be <= ${RECOVERY_SLA_MS}ms`)
                .toBeLessThanOrEqual(RECOVERY_SLA_MS)

            await waitRoleReadyNoAssist(other, OTHER[who])
            await assertStateConnected(pCaller, 'caller')
            await assertStateConnected(pCallee, 'callee')

            await assertPingStrict(reloaded, who, other, `after-${who}-reload-step-${step}`)
            await assertPingStrict(other, OTHER[who], reloaded, `pong-after-${who}-reload-step-${step}`)
        }
    })

    test('same side double reload still recovers', async () => {
        for (let i = 1; i <= 2; i++) {
            const elapsedMs = await reloadRoleStrict(pCallee, 'callee', roomId)
            expect(elapsedMs, `callee recovery #${i} must be <= ${RECOVERY_SLA_MS}ms`).toBeLessThanOrEqual(RECOVERY_SLA_MS)
            await waitRoleReadyNoAssist(pCaller, 'caller')
            await assertStateConnected(pCaller, 'caller')
            await assertStateConnected(pCallee, 'callee')
            await assertPingStrict(pCaller, 'caller', pCallee, `after-callee-double-${i}`)
        }

        for (let i = 1; i <= 2; i++) {
            const elapsedMs = await reloadRoleStrict(pCaller, 'caller', roomId)
            expect(elapsedMs, `caller recovery #${i} must be <= ${RECOVERY_SLA_MS}ms`).toBeLessThanOrEqual(RECOVERY_SLA_MS)
            await waitRoleReadyNoAssist(pCallee, 'callee')
            await assertStateConnected(pCaller, 'caller')
            await assertStateConnected(pCallee, 'callee')
            await assertPingStrict(pCallee, 'callee', pCaller, `after-caller-double-${i}`)
        }
    })
})
