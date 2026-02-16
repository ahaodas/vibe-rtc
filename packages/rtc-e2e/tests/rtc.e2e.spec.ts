import { test, expect, Page } from '@playwright/test'

type Who = 'caller' | 'callee'
const OTHER: Record<Who, Who> = { caller: 'callee', callee: 'caller' }

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

async function bootPair(pCaller: Page, pCallee: Page, baseURL: string) {
    captureConsole(pCaller, 'caller')
    captureConsole(pCallee, 'callee')

    await pCaller.goto(`${baseURL}/e2e-rtc.html`)
    await pCallee.goto(`${baseURL}/e2e-rtc.html`)

    await pCaller.waitForFunction(() => !!(window as any).app)
    await pCallee.waitForFunction(() => !!(window as any).app)

    const roomId = await pCaller.evaluate(async () => {
        ;(window as any).caller = await (window as any).app.makeCaller()
        return await (window as any).caller.hostRoom()
    })

    await pCallee.evaluate(async (rid) => {
        ;(window as any).callee = await (window as any).app.makeCallee()
        await (window as any).callee.joinRoom(rid)
    }, roomId)

    // пробуем «поднять» обе стороны
    await ensurePairReady(pCaller, pCallee, 20000)

    // sanity ping
    await assertPing(pCaller, 'caller', pCallee, 'sanity-from-caller')
    await assertPing(pCallee, 'callee', pCaller, 'sanity-from-callee')

    return roomId
}

async function ensurePairReady(pCaller: Page, pCallee: Page, totalMs = 20000) {
    await Promise.all([
        pCaller.evaluate(async (ms) => { await (window as any).caller.ensureReady(ms) }, totalMs),
        // небольшое смещение, чтобы снизить шанс glare/коллизий
        (async () => { await pCallee.waitForTimeout(150); await pCallee.evaluate(async (ms) => { await (window as any).callee.ensureReady(ms) }, totalMs) })(),
    ])
}

async function reloadRole(page: Page, who: Who, roomId: string, otherPage: Page) {
    await page.reload()
    await page.waitForFunction(() => !!(window as any).app)

    await page.evaluate(async ({ who, roomId }) => {
        if (who === 'caller') {
            ;(window as any).caller = await (window as any).app.makeCaller()
            await (window as any).caller.joinRoom(roomId)
        } else {
            ;(window as any).callee = await (window as any).app.makeCallee()
            await (window as any).callee.joinRoom(roomId)
        }
    }, { who, roomId })

    // сначала восстанавливаемся на перезагруженной стороне
    await page.evaluate(async (w) => {
        const obj = (window as any)[w]
        await obj.ensureReady(20000)
        obj.flush?.()
    }, who)

    // затем «пинаем» вторую сторону (она могла залипнуть в checking)
    await otherPage.evaluate(async (w) => {
        const obj = (window as any)[w]
        await obj.ensureReady(12000)
        obj.flush?.()
    }, OTHER[who])
}

async function assertPing(from: Page, whoFrom: Who, to: Page, expectedText: string) {
    const trySend = async (label: string) => {
        // eslint-disable-next-line no-console
        console.log(`[assertPing:${label}] send "${expectedText}" from=${whoFrom}`)
        if (whoFrom === 'caller') {
            await from.evaluate(async (t) => { await (window as any).caller.sendReliable(t) }, expectedText)
        } else {
            await from.evaluate(async (t) => { await (window as any).callee.sendReliable(t) }, expectedText)
        }
        await to.waitForTimeout(300)
        const got = whoFrom === 'caller'
            ? await to.evaluate(() => (window as any).callee.takeMessages())
            : await to.evaluate(() => (window as any).caller.takeMessages())
        // eslint-disable-next-line no-console
        console.log(`[assertPing:${label}] got=`, got)
        return got.includes(expectedText)
    }

    if (await trySend('1')) return

    // лечим принимающего
    await to.evaluate(async (w) => { await (window as any)[w].ensureReady(6000) }, whoFrom === 'caller' ? 'callee' : 'caller')
    if (await trySend('2')) return

    // лечим отправителя
    await from.evaluate(async (w) => { await (window as any)[w].ensureReady(6000) }, whoFrom)
    if (await trySend('3')) return

    // финальная диагностика
    const sFrom = await from.evaluate((w) => (window as any)[w].getState(), whoFrom)
    const sTo = await to.evaluate((w) => (window as any)[w].getState(), whoFrom === 'caller' ? 'callee' : 'caller')
    // eslint-disable-next-line no-console
    console.log(`[assertPing:diag] from=`, sFrom, `to=`, sTo)

    expect(false, `ping "${expectedText}" not delivered`).toBe(true)
}

test.describe('reload sequences (caller/callee)', () => {
    test.setTimeout(120_000) // на всякий случай увеличим лимит набора тестов

    test('A) callee reload x3, then caller reload x2 (с проверкой после каждого шага)', async ({ context, baseURL }) => {
        const pCaller = await context.newPage()
        const pCallee = await context.newPage()
        const roomId = await bootPair(pCaller, pCallee, baseURL)

        for (let i = 1; i <= 3; i++) {
            await reloadRole(pCallee, 'callee', roomId, pCaller)
            await assertPing(pCaller, 'caller', pCallee, `after-callee-reload-${i}`)
            await assertPing(pCallee, 'callee', pCaller, `back-callee-reload-${i}`)
        }

        for (let j = 1; j <= 2; j++) {
            await reloadRole(pCaller, 'caller', roomId, pCallee)
            await assertPing(pCallee, 'callee', pCaller, `after-caller-reload-${j}`)
            await assertPing(pCaller, 'caller', pCallee, `back-caller-reload-${j}`)
        }
    })

    test('B) чередование: caller → callee → caller → callee (по одному разу)', async ({ context, baseURL }) => {
        const pCaller = await context.newPage()
        const pCallee = await context.newPage()
        const roomId = await bootPair(pCaller, pCallee, baseURL)

        const seq: Who[] = ['caller', 'callee', 'caller', 'callee']
        let step = 0
        for (const who of seq) {
            step++
            await reloadRole(who === 'caller' ? pCaller : pCallee, who, roomId, who === 'caller' ? pCallee : pCaller)

            await assertPing(
                who === 'caller' ? pCaller : pCallee,
                who,
                who === 'caller' ? pCallee : pCaller,
                `ping-after-${who}-reload-step-${step}`,
            )
            const back: Who = who === 'caller' ? 'callee' : 'caller'
            await assertPing(
                back === 'caller' ? pCaller : pCallee,
                back,
                back === 'caller' ? pCallee : pCaller,
                `pong-after-${who}-reload-step-${step}`,
            )
        }
    })

    test('C) стресс: дважды callee подряд, затем дважды caller подряд', async ({ context, baseURL }) => {
        const pCaller = await context.newPage()
        const pCallee = await context.newPage()
        const roomId = await bootPair(pCaller, pCallee, baseURL)

        await reloadRole(pCallee, 'callee', roomId, pCaller)
        await assertPing(pCaller, 'caller', pCallee, 'after-callee-1')

        await reloadRole(pCallee, 'callee', roomId, pCaller)
        await assertPing(pCaller, 'caller', pCallee, 'after-callee-2')

        await reloadRole(pCaller, 'caller', roomId, pCallee)
        await assertPing(pCallee, 'callee', pCaller, 'after-caller-1')

        await reloadRole(pCaller, 'caller', roomId, pCallee)
        await assertPing(pCallee, 'callee', pCaller, 'after-caller-2')
    })

    test('D) длинная цепочка: C C C → K → C → K K (C=callee, K=caller)', async ({ context, baseURL }) => {
        const pCaller = await context.newPage()
        const pCallee = await context.newPage()
        const roomId = await bootPair(pCaller, pCallee, baseURL)

        const seq: Who[] = ['callee', 'callee', 'callee', 'caller', 'callee', 'caller', 'caller']
        let idx = 0
        for (const who of seq) {
            idx++
            await reloadRole(who === 'caller' ? pCaller : pCallee, who, roomId, who === 'caller' ? pCallee : pCaller)

            const sender: Who = who === 'caller' ? 'callee' : 'caller'
            await assertPing(
                sender === 'caller' ? pCaller : pCallee,
                sender,
                sender === 'caller' ? pCallee : pCaller,
                `chain-${idx}-from-${sender}`,
            )
        }
    })
})
