import { expect, type Page, test } from '@playwright/test'
import type { RoomInvite } from '@vibe-rtc/rtc-react'

type Role = 'caller' | 'callee'

type HookState = {
    status: string
    invite: RoomInvite | null
    lastError?: { code?: string; message: string } | null
}

type HookAppApi = {
    hostRoom: () => Promise<RoomInvite>
    joinWithInvite: (invite: RoomInvite, role?: Role) => Promise<void>
    waitReadyNoAssist: (timeoutMs?: number) => Promise<void>
    sendReliable: (text: string) => Promise<void>
    takeMessages: () => string[]
    getState: () => HookState
    attachFromHash: () => Promise<void>
}

type HookWindow = Window & {
    hookApp: HookAppApi
}

const USING_FIREBASE_EMULATOR =
    Boolean(process.env.FIRESTORE_EMULATOR_HOST) ||
    Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST) ||
    Boolean(process.env.VITE_FIRESTORE_EMULATOR_HOST) ||
    Boolean(process.env.VITE_FIREBASE_AUTH_EMULATOR_HOST)

const READY_TIMEOUT_MS = USING_FIREBASE_EMULATOR ? 30_000 : 45_000
const TAKEOVER_TIMEOUT_MS = USING_FIREBASE_EMULATOR ? 45_000 : 75_000

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

async function waitHookAppReady(page: Page) {
    await page.waitForFunction(() => !!(window as unknown as HookWindow).hookApp, undefined, {
        timeout: READY_TIMEOUT_MS,
    })
}

async function openHookPage(page: Page, baseURL: string, tag: string, hash = '') {
    captureConsole(page, tag)
    await page.goto(`${baseURL}/e2e-hook.html${hash}`)
    await waitHookAppReady(page)
}

async function hostRoom(page: Page): Promise<RoomInvite> {
    return await page.evaluate(async () => {
        return await (window as unknown as HookWindow).hookApp.hostRoom()
    })
}

async function joinWithInvite(page: Page, invite: RoomInvite, role: Role) {
    await page.evaluate(
        async ({ invite, role }) => {
            await (window as unknown as HookWindow).hookApp.joinWithInvite(invite, role)
        },
        { invite, role },
    )
}

async function waitReady(page: Page, timeoutMs = READY_TIMEOUT_MS) {
    await page.evaluate(async (timeout) => {
        await (window as unknown as HookWindow).hookApp.waitReadyNoAssist(timeout)
    }, timeoutMs)
}

async function sendReliable(page: Page, text: string) {
    await page.evaluate(async (payload) => {
        await (window as unknown as HookWindow).hookApp.sendReliable(payload)
    }, text)
}

async function getState(page: Page): Promise<HookState> {
    return await page.evaluate(() => {
        return (window as unknown as HookWindow).hookApp.getState()
    })
}

async function assertMessageDelivered(page: Page, expectedText: string) {
    await expect
        .poll(
            async () => {
                return await page.evaluate((text) => {
                    const received = (window as unknown as HookWindow).hookApp.takeMessages()
                    return received.includes(text)
                }, expectedText)
            },
            { timeout: 8_000, intervals: [100, 150, 250] },
        )
        .toBe(true)
}

function buildHookAttachHash(role: Role, invite: RoomInvite): string {
    const encodedInvite = encodeURIComponent(JSON.stringify(invite))
    return `#/hook/${role}?invite=${encodedInvite}`
}

test.describe('rtc-react hook e2e', () => {
    test('new dx: caller auto-creates invite, callee joins by invite, reload resumes by invite', async ({
        browser,
        baseURL,
    }) => {
        if (!baseURL) throw new Error('baseURL is not configured')

        const context = await browser.newContext()
        const caller = await context.newPage()
        const callee = await context.newPage()

        await openHookPage(caller, baseURL, 'hook-caller')
        await openHookPage(callee, baseURL, 'hook-callee')

        const invite = await hostRoom(caller)
        expect(invite.roomId.length).toBeGreaterThan(0)
        const sharedInvite: RoomInvite = {
            roomId: invite.roomId,
            connectionStrategy: invite.connectionStrategy,
        }

        await joinWithInvite(callee, sharedInvite, 'callee')
        await Promise.all([waitReady(caller), waitReady(callee)])

        await sendReliable(caller, 'hook-dx-before-reload')
        await assertMessageDelivered(callee, 'hook-dx-before-reload')

        await callee.reload()
        await waitHookAppReady(callee)
        await joinWithInvite(callee, sharedInvite, 'callee')
        await Promise.all([waitReady(caller), waitReady(callee)])

        await sendReliable(caller, 'hook-dx-after-reload')
        await assertMessageDelivered(callee, 'hook-dx-after-reload')

        await context.close()
    })

    test('new dx: attach from hash restores by external invite payload', async ({
        browser,
        baseURL,
    }) => {
        if (!baseURL) throw new Error('baseURL is not configured')

        const context = await browser.newContext()
        const caller = await context.newPage()

        await openHookPage(caller, baseURL, 'hook-hash-caller')
        const invite = await hostRoom(caller)
        const sharedInvite: RoomInvite = {
            roomId: invite.roomId,
            connectionStrategy: invite.connectionStrategy,
        }

        const callee = await context.newPage()
        const hash = buildHookAttachHash('callee', sharedInvite)
        await openHookPage(callee, baseURL, 'hook-hash-callee', hash)
        await callee.evaluate(async () => {
            await (window as unknown as HookWindow).hookApp.attachFromHash()
        })

        await Promise.all([waitReady(caller), waitReady(callee)])

        await sendReliable(callee, 'hook-hash-message')
        await assertMessageDelivered(caller, 'hook-hash-message')

        await context.close()
    })

    test('takeover: new caller becomes active, previous caller is disconnected with takeover signal', async ({
        browser,
        baseURL,
    }) => {
        if (!baseURL) throw new Error('baseURL is not configured')

        const context = await browser.newContext()
        const caller = await context.newPage()
        const callee = await context.newPage()

        await openHookPage(caller, baseURL, 'hook-takeover-caller-old')
        await openHookPage(callee, baseURL, 'hook-takeover-callee')

        const invite = await hostRoom(caller)
        await joinWithInvite(callee, invite, 'callee')
        await Promise.all([waitReady(caller), waitReady(callee)])

        const callerTakeover = await context.newPage()
        await openHookPage(callerTakeover, baseURL, 'hook-takeover-caller-new')
        await joinWithInvite(callerTakeover, invite, 'caller')
        await Promise.all([waitReady(callerTakeover, TAKEOVER_TIMEOUT_MS), waitReady(callee)])

        await expect
            .poll(
                async () => {
                    const state = await getState(caller)
                    const errorCode = state.lastError?.code ?? ''
                    const errorMessage = state.lastError?.message ?? ''
                    const hasTakeoverError =
                        errorCode === 'TAKEOVER_DETECTED' ||
                        /takeover|taken over/i.test(errorMessage)
                    const disconnected = state.status === 'disconnected'
                    return hasTakeoverError || disconnected
                },
                { timeout: TAKEOVER_TIMEOUT_MS, intervals: [250, 500, 1000] },
            )
            .toBe(true)

        await sendReliable(callerTakeover, 'hook-takeover-new-caller-message')
        await assertMessageDelivered(callee, 'hook-takeover-new-caller-message')

        const takeoverState = await getState(callerTakeover)
        expect(takeoverState.status).toBe('connected')

        await context.close()
    })
})
