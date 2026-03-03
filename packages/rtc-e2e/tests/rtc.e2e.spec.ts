import { expect, type Page, test } from '@playwright/test'

type Who = 'caller' | 'callee'
type ConnectionStrategy = 'DEFAULT' | 'BROWSER_NATIVE'
const OTHER: Record<Who, Who> = { caller: 'callee', callee: 'caller' }

const READY_TIMEOUT_MS = 15_000
const USING_FIREBASE_EMULATOR =
    Boolean(process.env.FIRESTORE_EMULATOR_HOST) ||
    Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST) ||
    Boolean(process.env.VITE_FIRESTORE_EMULATOR_HOST) ||
    Boolean(process.env.VITE_FIREBASE_AUTH_EMULATOR_HOST)
const RECOVERY_SLA_MS = USING_FIREBASE_EMULATOR ? 12_000 : 10_000
const BROWSER_NATIVE_RECOVERY_SLA_MS = 15_000
const TAKEOVER_READY_TIMEOUT_MS = 45_000

type RoleState = {
    pcState: string
    fast?: { state?: string } | null
    reliable?: { state?: string } | null
    sessionId?: string | null
    phase?: string
}

type RoleApi = {
    waitReadyNoAssist: (timeoutMs: number) => Promise<void>
    waitReady?: (timeoutMs?: number) => Promise<void>
    sendReliable: (text: string) => Promise<void>
    takeMessages: () => string[]
    hostRoom: () => Promise<string>
    joinRoom: (roomId: string) => Promise<void>
    endRoom?: () => Promise<void>
    flush?: () => void
    getState: () => RoleState
}

type AppApi = {
    makeCaller: (opts?: { connectionStrategy?: ConnectionStrategy }) => Promise<RoleApi>
    makeCallee: (opts?: { connectionStrategy?: ConnectionStrategy }) => Promise<RoleApi>
}

type E2EWindow = Window & {
    app: AppApi
    caller?: RoleApi
    callee?: RoleApi
}

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
    await page.waitForFunction(() => !!(window as unknown as E2EWindow).app)
}

function isNavigationContextError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    return (
        message.includes('Execution context was destroyed') ||
        message.includes('Cannot find context with specified id') ||
        message.includes('Most likely because of a navigation')
    )
}

async function waitRoleReadyInternal(
    page: Page,
    who: Who,
    timeoutMs: number,
    noAssistOnly: boolean,
) {
    const startedAt = Date.now()
    const deadlineAt = startedAt + timeoutMs
    let lastNavigationError: unknown

    while (Date.now() < deadlineAt) {
        const remainingMs = Math.max(1, deadlineAt - Date.now())
        try {
            await page.evaluate(
                async ({ who, timeoutMs, noAssistOnly }) => {
                    const obj = (window as unknown as E2EWindow)[who]
                    if (!obj) throw new Error(`Role object is missing: ${who}`)
                    if (!noAssistOnly && typeof obj.waitReady === 'function') {
                        await obj.waitReady(timeoutMs)
                        return
                    }
                    await obj.waitReadyNoAssist(timeoutMs)
                },
                { who, timeoutMs: remainingMs, noAssistOnly },
            )
            return Date.now() - startedAt
        } catch (error) {
            if (!isNavigationContextError(error) || page.isClosed()) throw error
            lastNavigationError = error
            const waitAppForMs = Math.max(1, Math.min(remainingMs, 5_000))
            await page.waitForFunction(() => !!(window as unknown as E2EWindow).app, undefined, {
                timeout: waitAppForMs,
            })
            await page.waitForTimeout(120)
        }
    }

    if (lastNavigationError instanceof Error) throw lastNavigationError
    throw new Error(`waitRoleReady timeout: ${who}`)
}

async function waitRoleReadyNoAssist(page: Page, who: Who, timeoutMs = READY_TIMEOUT_MS) {
    return await waitRoleReadyInternal(page, who, timeoutMs, true)
}

async function waitRoleReady(page: Page, who: Who, timeoutMs = READY_TIMEOUT_MS) {
    return await waitRoleReadyInternal(page, who, timeoutMs, false)
}

function isConnected(st: RoleState | null | undefined): boolean {
    return st?.pcState === 'connected' && st.fast?.state === 'open' && st.reliable?.state === 'open'
}

async function getRoleState(page: Page, who: Who): Promise<RoleState> {
    const st = await page.evaluate((w) => (window as unknown as E2EWindow)[w]?.getState(), who)
    if (!st) throw new Error(`Role state is missing: ${who}`)
    return st
}

async function assertStateConnected(page: Page, who: Who) {
    const st = await getRoleState(page, who)
    expect(st.pcState, `${who} pcState`).toBe('connected')
    expect(st.fast?.state, `${who} fast channel`).toBe('open')
    expect(st.reliable?.state, `${who} reliable channel`).toBe('open')
}

async function assertPingStrict(from: Page, whoFrom: Who, to: Page, expectedText: string) {
    if (whoFrom === 'caller') {
        await from.evaluate(async (t) => {
            await (window as unknown as E2EWindow).caller?.sendReliable(t)
        }, expectedText)
        await expect
            .poll(
                async () => {
                    const got = await to.evaluate(
                        () => (window as unknown as E2EWindow).callee?.takeMessages() ?? [],
                    )
                    return got.includes(expectedText)
                },
                { timeout: 5_000, intervals: [100] },
            )
            .toBe(true)
        return
    }

    await from.evaluate(async (t) => {
        await (window as unknown as E2EWindow).callee?.sendReliable(t)
    }, expectedText)
    await expect
        .poll(
            async () => {
                const got = await to.evaluate(
                    () => (window as unknown as E2EWindow).caller?.takeMessages() ?? [],
                )
                return got.includes(expectedText)
            },
            { timeout: 5_000, intervals: [100] },
        )
        .toBe(true)
}

async function openRolePage(
    page: Page,
    baseURL: string,
    who: Who,
    roomId: string,
    tag: string,
    connectionStrategy: ConnectionStrategy = 'DEFAULT',
) {
    captureConsole(page, tag)
    await page.goto(`${baseURL}/e2e-rtc.html`)
    await waitAppReady(page)
    await page.evaluate(
        async ({ who, roomId, connectionStrategy }) => {
            if (who === 'caller') {
                ;(window as unknown as E2EWindow).caller = await (
                    window as unknown as E2EWindow
                ).app.makeCaller({ connectionStrategy })
                const caller = (window as unknown as E2EWindow).caller
                if (!caller) throw new Error('caller role is missing after makeCaller')
                await caller.joinRoom(roomId)
                return
            }
            ;(window as unknown as E2EWindow).callee = await (
                window as unknown as E2EWindow
            ).app.makeCallee({ connectionStrategy })
            const callee = (window as unknown as E2EWindow).callee
            if (!callee) throw new Error('callee role is missing after makeCallee')
            await callee.joinRoom(roomId)
        },
        { who, roomId, connectionStrategy },
    )
}

async function flushMessages(page: Page, who: Who) {
    await page.evaluate((w) => (window as unknown as E2EWindow)[w]?.flush?.(), who)
}

async function takeMessages(page: Page, who: Who): Promise<string[]> {
    return await page.evaluate(
        (w) => (window as unknown as E2EWindow)[w]?.takeMessages() ?? [],
        who,
    )
}

async function sendReliable(page: Page, who: Who, text: string) {
    await page.evaluate(
        async ({ who, text }) => {
            const role = (window as unknown as E2EWindow)[who]
            if (!role) throw new Error(`Role object is missing: ${who}`)
            await role.sendReliable(text)
        },
        { who, text },
    )
}

async function expectReceivesMessage(page: Page, who: Who, text: string, timeoutMs = 5_000) {
    await expect
        .poll(
            async () => {
                const got = await takeMessages(page, who)
                return got.includes(text)
            },
            { timeout: timeoutMs, intervals: [100] },
        )
        .toBe(true)
}

async function expectNoMessage(page: Page, who: Who, text: string, observeMs = 2_000) {
    const startedAt = Date.now()
    while (Date.now() - startedAt < observeMs) {
        const got = await takeMessages(page, who)
        expect(got.includes(text), `${who} must not receive stale message "${text}"`).toBe(false)
        await page.waitForTimeout(120)
    }
}

async function waitRoleDisconnected(page: Page, who: Who, timeoutMs = 20_000) {
    await expect
        .poll(
            async () => {
                const st = await getRoleState(page, who)
                return isConnected(st)
            },
            { timeout: timeoutMs, intervals: [150, 300, 500] },
        )
        .toBe(false)
}

async function assertRoleStaysDisconnected(page: Page, who: Who, observeMs = 4_000) {
    const startedAt = Date.now()
    while (Date.now() - startedAt < observeMs) {
        const st = await getRoleState(page, who)
        expect(isConnected(st), `${who} must stay disconnected after takeover`).toBe(false)
        await page.waitForTimeout(200)
    }
}

async function bootPair(
    pCaller: Page,
    pCallee: Page,
    baseURL: string,
    connectionStrategy: ConnectionStrategy = 'DEFAULT',
) {
    captureConsole(pCaller, 'caller')
    captureConsole(pCallee, 'callee')

    await pCaller.goto(`${baseURL}/e2e-rtc.html`)
    await pCallee.goto(`${baseURL}/e2e-rtc.html`)
    await Promise.all([waitAppReady(pCaller), waitAppReady(pCallee)])

    const roomId = await pCaller.evaluate(async (strategy) => {
        ;(window as unknown as E2EWindow).caller = await (
            window as unknown as E2EWindow
        ).app.makeCaller({ connectionStrategy: strategy })
        const caller = (window as unknown as E2EWindow).caller
        if (!caller) throw new Error('caller role is missing after makeCaller')
        return await caller.hostRoom()
    }, connectionStrategy)

    await pCallee.evaluate(
        async ({ rid, strategy }) => {
            ;(window as unknown as E2EWindow).callee = await (
                window as unknown as E2EWindow
            ).app.makeCallee({ connectionStrategy: strategy })
            const callee = (window as unknown as E2EWindow).callee
            if (!callee) throw new Error('callee role is missing after makeCallee')
            await callee.joinRoom(rid)
        },
        { rid: roomId, strategy: connectionStrategy },
    )

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

async function reloadRoleStrict(
    page: Page,
    who: Who,
    roomId: string,
    connectionStrategy: ConnectionStrategy = 'DEFAULT',
) {
    await page.reload()
    await waitAppReady(page)

    await page.evaluate(
        async ({ who, roomId, connectionStrategy }) => {
            if (who === 'caller') {
                ;(window as unknown as E2EWindow).caller = await (
                    window as unknown as E2EWindow
                ).app.makeCaller({ connectionStrategy })
                const caller = (window as unknown as E2EWindow).caller
                if (!caller) throw new Error('caller role is missing after reload')
                await caller.joinRoom(roomId)
                return
            }
            ;(window as unknown as E2EWindow).callee = await (
                window as unknown as E2EWindow
            ).app.makeCallee({ connectionStrategy })
            const callee = (window as unknown as E2EWindow).callee
            if (!callee) throw new Error('callee role is missing after reload')
            await callee.joinRoom(roomId)
        },
        { who, roomId, connectionStrategy },
    )

    return await waitRoleReadyNoAssist(page, who)
}

async function reloadRoleNoWait(
    page: Page,
    who: Who,
    roomId: string,
    connectionStrategy: ConnectionStrategy = 'DEFAULT',
) {
    await page.reload()
    await waitAppReady(page)

    await page.evaluate(
        async ({ who, roomId, connectionStrategy }) => {
            if (who === 'caller') {
                ;(window as unknown as E2EWindow).caller = await (
                    window as unknown as E2EWindow
                ).app.makeCaller({ connectionStrategy })
                const caller = (window as unknown as E2EWindow).caller
                if (!caller) throw new Error('caller role is missing after reload')
                await caller.joinRoom(roomId)
                return
            }
            ;(window as unknown as E2EWindow).callee = await (
                window as unknown as E2EWindow
            ).app.makeCallee({ connectionStrategy })
            const callee = (window as unknown as E2EWindow).callee
            if (!callee) throw new Error('callee role is missing after reload')
            await callee.joinRoom(roomId)
        },
        { who, roomId, connectionStrategy },
    )
}

async function cleanupPair(pCaller: Page, pCallee: Page) {
    for (const [page, who] of [
        [pCaller, 'caller'],
        [pCallee, 'callee'],
    ] as const) {
        try {
            await page.evaluate(async (w) => {
                const obj = (window as unknown as E2EWindow)[w]
                if (!obj?.endRoom) return
                await obj.endRoom()
            }, who)
        } catch {}
    }
}

async function cleanupRole(page: Page, who: Who) {
    try {
        await page.evaluate(async (w) => {
            const obj = (window as unknown as E2EWindow)[w]
            if (!obj?.endRoom) return
            await obj.endRoom()
        }, who)
    } catch {}
}

test.describe('reload recovery (strict no-assist)', () => {
    test.setTimeout(120_000)

    let pCaller: Page
    let pCallee: Page
    let roomId: string

    test.beforeEach(async ({ context, baseURL }) => {
        pCaller = await context.newPage()
        pCallee = await context.newPage()
        if (!baseURL) {
            throw new Error('Playwright baseURL is required for rtc e2e tests')
        }
        roomId = await bootPair(pCaller, pCallee, baseURL)
    })

    test.afterEach(async () => {
        await cleanupPair(pCaller, pCallee)
    })

    test('caller reload recovers within SLA and message flow survives', async () => {
        const elapsedMs = await reloadRoleStrict(pCaller, 'caller', roomId)
        expect(elapsedMs, `caller recovery must be <= ${RECOVERY_SLA_MS}ms`).toBeLessThanOrEqual(
            RECOVERY_SLA_MS,
        )

        await waitRoleReadyNoAssist(pCallee, 'callee')
        await assertStateConnected(pCaller, 'caller')
        await assertStateConnected(pCallee, 'callee')

        await assertPingStrict(pCaller, 'caller', pCallee, 'after-caller-reload')
        await assertPingStrict(pCallee, 'callee', pCaller, 'pong-after-caller-reload')
    })

    test('callee reload recovers within SLA and message flow survives', async () => {
        const elapsedMs = await reloadRoleStrict(pCallee, 'callee', roomId)
        expect(elapsedMs, `callee recovery must be <= ${RECOVERY_SLA_MS}ms`).toBeLessThanOrEqual(
            RECOVERY_SLA_MS,
        )

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
            expect(
                elapsedMs,
                `${who} recovery at step ${step} must be <= ${RECOVERY_SLA_MS}ms`,
            ).toBeLessThanOrEqual(RECOVERY_SLA_MS)

            await waitRoleReadyNoAssist(other, OTHER[who])
            await assertStateConnected(pCaller, 'caller')
            await assertStateConnected(pCallee, 'callee')

            await assertPingStrict(reloaded, who, other, `after-${who}-reload-step-${step}`)
            await assertPingStrict(
                other,
                OTHER[who],
                reloaded,
                `pong-after-${who}-reload-step-${step}`,
            )
        }
    })

    test('same side double reload still recovers', async () => {
        for (let i = 1; i <= 2; i++) {
            const elapsedMs = await reloadRoleStrict(pCallee, 'callee', roomId)
            expect(
                elapsedMs,
                `callee recovery #${i} must be <= ${RECOVERY_SLA_MS}ms`,
            ).toBeLessThanOrEqual(RECOVERY_SLA_MS)
            await waitRoleReadyNoAssist(pCaller, 'caller')
            await assertStateConnected(pCaller, 'caller')
            await assertStateConnected(pCallee, 'callee')
            await assertPingStrict(pCaller, 'caller', pCallee, `after-callee-double-${i}`)
        }

        for (let i = 1; i <= 2; i++) {
            const elapsedMs = await reloadRoleStrict(pCaller, 'caller', roomId)
            expect(
                elapsedMs,
                `caller recovery #${i} must be <= ${RECOVERY_SLA_MS}ms`,
            ).toBeLessThanOrEqual(RECOVERY_SLA_MS)
            await waitRoleReadyNoAssist(pCallee, 'callee')
            await assertStateConnected(pCaller, 'caller')
            await assertStateConnected(pCallee, 'callee')
            await assertPingStrict(pCallee, 'callee', pCaller, `after-caller-double-${i}`)
        }
    })

    test('simultaneous caller+callee reload recovers', async () => {
        for (let i = 1; i <= 2; i++) {
            await Promise.all([
                reloadRoleNoWait(pCaller, 'caller', roomId),
                reloadRoleNoWait(pCallee, 'callee', roomId),
            ])

            const [callerMs, calleeMs] = await Promise.all([
                waitRoleReadyNoAssist(pCaller, 'caller', RECOVERY_SLA_MS),
                waitRoleReadyNoAssist(pCallee, 'callee', RECOVERY_SLA_MS),
            ])

            expect(
                callerMs,
                `caller simultaneous recovery #${i} must be <= ${RECOVERY_SLA_MS}ms`,
            ).toBeLessThanOrEqual(RECOVERY_SLA_MS)
            expect(
                calleeMs,
                `callee simultaneous recovery #${i} must be <= ${RECOVERY_SLA_MS}ms`,
            ).toBeLessThanOrEqual(RECOVERY_SLA_MS)

            await assertStateConnected(pCaller, 'caller')
            await assertStateConnected(pCallee, 'callee')

            await assertPingStrict(pCaller, 'caller', pCallee, `after-simultaneous-${i}-caller`)
            await assertPingStrict(pCallee, 'callee', pCaller, `after-simultaneous-${i}-callee`)
        }
    })
})

test.describe('browser-native strategy recovery (strict no-assist)', () => {
    test.setTimeout(120_000)

    let pCaller: Page
    let pCallee: Page
    let roomId: string

    test.beforeEach(async ({ context, baseURL }) => {
        pCaller = await context.newPage()
        pCallee = await context.newPage()
        if (!baseURL) {
            throw new Error('Playwright baseURL is required for rtc e2e tests')
        }
        roomId = await bootPair(pCaller, pCallee, baseURL, 'BROWSER_NATIVE')
    })

    test.afterEach(async () => {
        await cleanupPair(pCaller, pCallee)
    })

    test('caller reload recovers and message flow survives in BROWSER_NATIVE mode', async () => {
        const elapsedMs = await reloadRoleStrict(pCaller, 'caller', roomId, 'BROWSER_NATIVE')
        expect(
            elapsedMs,
            `caller BROWSER_NATIVE recovery must be <= ${BROWSER_NATIVE_RECOVERY_SLA_MS}ms`,
        ).toBeLessThanOrEqual(BROWSER_NATIVE_RECOVERY_SLA_MS)

        await waitRoleReadyNoAssist(pCallee, 'callee')
        await assertStateConnected(pCaller, 'caller')
        await assertStateConnected(pCallee, 'callee')

        await assertPingStrict(pCaller, 'caller', pCallee, 'native-after-caller-reload')
        await assertPingStrict(pCallee, 'callee', pCaller, 'native-pong-after-caller-reload')
    })

    test('callee reload recovers and message flow survives in BROWSER_NATIVE mode', async () => {
        const elapsedMs = await reloadRoleStrict(pCallee, 'callee', roomId, 'BROWSER_NATIVE')
        expect(
            elapsedMs,
            `callee BROWSER_NATIVE recovery must be <= ${BROWSER_NATIVE_RECOVERY_SLA_MS}ms`,
        ).toBeLessThanOrEqual(BROWSER_NATIVE_RECOVERY_SLA_MS)

        await waitRoleReadyNoAssist(pCaller, 'caller')
        await assertStateConnected(pCaller, 'caller')
        await assertStateConnected(pCallee, 'callee')

        await assertPingStrict(pCaller, 'caller', pCallee, 'native-after-callee-reload')
        await assertPingStrict(pCallee, 'callee', pCaller, 'native-pong-after-callee-reload')
    })
})

test.describe('takeover (same role, last page wins)', () => {
    test.setTimeout(120_000)

    let pCaller: Page
    let pCallee: Page
    let roomId: string
    let extraPages: Array<{ page: Page; who: Who }>

    test.beforeEach(async ({ context, baseURL }) => {
        pCaller = await context.newPage()
        pCallee = await context.newPage()
        extraPages = []
        if (!baseURL) {
            throw new Error('Playwright baseURL is required for rtc e2e tests')
        }
        roomId = await bootPair(pCaller, pCallee, baseURL)
    })

    test.afterEach(async () => {
        for (const extra of extraPages) {
            await cleanupRole(extra.page, extra.who)
        }
        await cleanupPair(pCaller, pCallee)
    })

    test('caller takeover makes new caller active and old caller inactive', async ({
        context,
        baseURL,
    }) => {
        if (!baseURL) throw new Error('Playwright baseURL is required for rtc e2e tests')
        const callerBefore = await getRoleState(pCaller, 'caller')
        const oldCallerSession = callerBefore.sessionId ?? null

        const pCaller2 = await context.newPage()
        extraPages.push({ page: pCaller2, who: 'caller' })
        await openRolePage(pCaller2, baseURL, 'caller', roomId, 'caller2')

        await Promise.all([
            waitRoleReady(pCaller2, 'caller', TAKEOVER_READY_TIMEOUT_MS),
            waitRoleReady(pCallee, 'callee', TAKEOVER_READY_TIMEOUT_MS),
        ])

        await assertStateConnected(pCaller2, 'caller')
        await assertStateConnected(pCallee, 'callee')
        await waitRoleDisconnected(pCaller, 'caller')
        if (oldCallerSession) {
            const callerAfter = await getRoleState(pCaller2, 'caller')
            if (callerAfter.sessionId) {
                expect(callerAfter.sessionId).not.toBe(oldCallerSession)
            }
        }

        await Promise.all([
            flushMessages(pCaller, 'caller'),
            flushMessages(pCaller2, 'caller'),
            flushMessages(pCallee, 'callee'),
        ])

        const marker = `takeover-caller-${Date.now()}`
        await sendReliable(pCallee, 'callee', marker)
        await expectReceivesMessage(pCaller2, 'caller', marker)
        await expectNoMessage(pCaller, 'caller', marker)
        await assertRoleStaysDisconnected(pCaller, 'caller')
    })

    test('callee takeover makes new callee active and old callee inactive', async ({
        context,
        baseURL,
    }) => {
        if (!baseURL) throw new Error('Playwright baseURL is required for rtc e2e tests')
        const calleeBefore = await getRoleState(pCallee, 'callee')
        const oldCalleeSession = calleeBefore.sessionId ?? null

        const pCallee2 = await context.newPage()
        extraPages.push({ page: pCallee2, who: 'callee' })
        await openRolePage(pCallee2, baseURL, 'callee', roomId, 'callee2')

        await Promise.all([
            waitRoleReady(pCallee2, 'callee', TAKEOVER_READY_TIMEOUT_MS),
            waitRoleReady(pCaller, 'caller', TAKEOVER_READY_TIMEOUT_MS),
        ])

        await assertStateConnected(pCaller, 'caller')
        await assertStateConnected(pCallee2, 'callee')
        await waitRoleDisconnected(pCallee, 'callee')
        if (oldCalleeSession) {
            const calleeAfter = await getRoleState(pCallee2, 'callee')
            if (calleeAfter.sessionId) {
                expect(calleeAfter.sessionId).not.toBe(oldCalleeSession)
            }
        }

        await Promise.all([
            flushMessages(pCaller, 'caller'),
            flushMessages(pCallee, 'callee'),
            flushMessages(pCallee2, 'callee'),
        ])

        const marker = `takeover-callee-${Date.now()}`
        await sendReliable(pCaller, 'caller', marker)
        await expectReceivesMessage(pCallee2, 'callee', marker)
        await expectNoMessage(pCallee, 'callee', marker)
        await assertRoleStaysDisconnected(pCallee, 'callee')
    })

    test('third page takeover does not break active pair stability', async ({
        context,
        baseURL,
    }) => {
        if (!baseURL) throw new Error('Playwright baseURL is required for rtc e2e tests')

        const pCaller2 = await context.newPage()
        extraPages.push({ page: pCaller2, who: 'caller' })
        await openRolePage(pCaller2, baseURL, 'caller', roomId, 'caller2')
        await Promise.all([
            waitRoleReady(pCaller2, 'caller', TAKEOVER_READY_TIMEOUT_MS),
            waitRoleReady(pCallee, 'callee', TAKEOVER_READY_TIMEOUT_MS),
        ])
        await waitRoleDisconnected(pCaller, 'caller')

        const pCaller3 = await context.newPage()
        extraPages.push({ page: pCaller3, who: 'caller' })
        await openRolePage(pCaller3, baseURL, 'caller', roomId, 'caller3')
        await Promise.all([
            waitRoleReady(pCaller3, 'caller', TAKEOVER_READY_TIMEOUT_MS),
            waitRoleReady(pCallee, 'callee', TAKEOVER_READY_TIMEOUT_MS),
        ])

        await assertStateConnected(pCaller3, 'caller')
        await assertStateConnected(pCallee, 'callee')
        await waitRoleDisconnected(pCaller2, 'caller')

        await Promise.all([
            flushMessages(pCaller, 'caller'),
            flushMessages(pCaller2, 'caller'),
            flushMessages(pCaller3, 'caller'),
            flushMessages(pCallee, 'callee'),
        ])

        const marker = `third-page-${Date.now()}`
        await sendReliable(pCallee, 'callee', marker)
        await expectReceivesMessage(pCaller3, 'caller', marker)
        await expectNoMessage(pCaller, 'caller', marker)
        await expectNoMessage(pCaller2, 'caller', marker)
        await assertRoleStaysDisconnected(pCaller2, 'caller')
        await assertRoleStaysDisconnected(pCaller, 'caller')
        await assertStateConnected(pCaller3, 'caller')
        await assertStateConnected(pCallee, 'callee')
    })
})
