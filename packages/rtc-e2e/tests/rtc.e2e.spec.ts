import { test, expect, Page } from '@playwright/test'

test('connect, two channels, send, soft/hard reconnect', async ({ context, baseURL }) => {
    const p1 = await context.newPage()
    const p2 = await context.newPage()

    await p1.goto(`${baseURL}/e2e-rtc.html`)
    await p2.goto(`${baseURL}/e2e-rtc.html`)

    await p1.waitForFunction(() => !!(window as any).app)
    await p2.waitForFunction(() => !!(window as any).app)

    const roomId = await p1.evaluate(async () => {
        ;(window as any).caller = await (window as any).app.makeCaller()
        return await (window as any).caller.hostRoom()
    })

    await p2.evaluate(async (rid) => {
        ;(window as any).callee = await (window as any).app.makeCallee()
        await (window as any).callee.joinRoom(rid)
    }, roomId)

    await p1.evaluate(async () => {
        await (window as any).caller.waitReady(15000)
    })
    await p2.evaluate(async () => {
        await (window as any).callee.waitReady(15000)
    })

    async function ensureReady(page: Page, who: 'caller' | 'callee') {
        try {
            await page.evaluate(async (w) => {
                await (window as any)[w].waitReady(8000)
            }, who)
        } catch {
            const diag = await page.evaluate((w) => (window as any)[w].inspect(), who)
            console.log(`[${who}] before soft-restart`, diag)
            await page.evaluate(async (w) => {
                await (window as any)[w].reconnectSoft()
            }, who)
            await page.evaluate(async (w) => {
                await (window as any)[w].waitReady(8000)
            }, who)
            const diag2 = await page.evaluate((w) => (window as any)[w].inspect(), who)
            console.log(`[${who}] after soft-restart`, diag2)
        }
    }

    await ensureReady(p1, 'caller')
    await ensureReady(p2, 'callee')

    await p1.evaluate(async () => {
        await (window as any).caller.sendFast('hello-fast')
        await (window as any).caller.sendReliable('hello-rel')
    })
    await p2.evaluate(async () => {
        await (window as any).callee.sendFast('hi-fast')
        await (window as any).callee.sendReliable('hi-rel')
    })

    await p1.waitForTimeout(200)

    const got1 = await p1.evaluate(() => (window as any).caller.takeMessages())
    const got2 = await p2.evaluate(() => (window as any).callee.takeMessages())
    expect(got1).toEqual(expect.arrayContaining(['hi-fast', 'hi-rel']))
    expect(got2).toEqual(expect.arrayContaining(['hello-fast', 'hello-rel']))

    await p1.evaluate(async () => {
        await (window as any).caller.reconnectSoft()
    })
    await p2.evaluate(async () => {
        await (window as any).callee.sendReliable('after-soft')
    })
    await p1.waitForTimeout(200)
    const afterSoft = await p1.evaluate(() => (window as any).caller.takeMessages())
    expect(afterSoft).toContain('after-soft')

    await p1.evaluate(async () => {
        await (window as any).caller.reconnectHard({ awaitReadyMs: 15000 })
    })

    await p2.evaluate(async () => {
        await (window as any).callee.sendFast('after-hard')
    })
    const afterHard = await p1.evaluate(() => (window as any).caller.takeMessages())
    expect(afterHard).toContain('after-hard')

    await p1.evaluate(async () => {
        await (window as any).caller.endRoom()
    })
})
