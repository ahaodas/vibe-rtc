import { expect, test, type Page } from '@playwright/test'
import { loadEnv } from 'vite'

const READY_TIMEOUT_MS = 45_000
const DEMO_ENV = loadEnv(process.env.NODE_ENV ?? 'development', process.cwd(), '')
const hasValue = (value: string | undefined) => Boolean(value && value.trim().length > 0)
const HAS_SIGNALING_ENV =
    hasValue(process.env.VITE_FIREBASE_PROJECT_ID ?? DEMO_ENV.VITE_FIREBASE_PROJECT_ID) &&
    hasValue(process.env.VITE_FIREBASE_API_KEY ?? DEMO_ENV.VITE_FIREBASE_API_KEY) &&
    hasValue(process.env.VITE_FIREBASE_APP_ID ?? DEMO_ENV.VITE_FIREBASE_APP_ID)
const HOME_URL_RE = /#\/$/
const CALLER_ATTACH_URL_RE = /#\/attach\/caller\/[^?]+(?:\?.*)?$/

function isIgnorableBrowserNoise(message: string, sourceUrl?: string): boolean {
    if (
        message.includes('Failed to load resource: the server responded with a status of 400') &&
        sourceUrl?.includes('firestore.googleapis.com')
    ) {
        return true
    }

    if (
        message.includes('Failed to load resource: the server responded with a status of 404') &&
        (!sourceUrl || sourceUrl.trim().length === 0)
    ) {
        return true
    }

    return (
        message.includes('ChromeMethodBFE') ||
        message.includes('Unable to create writable file') ||
        message.includes('IO error:') ||
        message.includes('content.js') ||
        message.includes('polyfill.js')
    )
}

function collectUnexpectedBrowserErrors(page: Page, tag: string) {
    const errors: string[] = []

    page.on('console', (msg) => {
        if (msg.type() !== 'error') return
        const text = msg.text()
        const sourceUrl = msg.location().url
        if (isIgnorableBrowserNoise(text, sourceUrl)) return
        errors.push(`[${tag}][console:error] ${text}`)
    })

    page.on('pageerror', (error) => {
        const text = error instanceof Error ? error.message : String(error)
        if (isIgnorableBrowserNoise(text)) return
        errors.push(`[${tag}][pageerror] ${text}`)
    })

    return () => {
        expect(errors, `Unexpected browser errors:\n${errors.join('\n')}`).toEqual([])
    }
}

function extractCallerRoomId(url: string): string {
    const match = url.match(/#\/attach\/caller\/([^?]+)/)
    if (!match || !match[1]) {
        throw new Error(`Failed to extract room id from URL: ${url}`)
    }
    return decodeURIComponent(match[1])
}

async function openHome(page: Page) {
    await page.goto('/#/')
    await expect(page.getByTestId('home-page')).toBeVisible()
}

async function waitMessagingReady(page: Page) {
    await expect(page.getByTestId('message-composer-input')).toBeEnabled({
        timeout: READY_TIMEOUT_MS,
    })
}

async function sendMessage(page: Page, mode: 'fast' | 'reliable', text: string) {
    const input = page.getByTestId('message-composer-input')

    await input.fill(text)
    await page.getByTestId(`message-composer-${mode}-btn`).click()
    await expect(input).toHaveValue('')
}

async function drawCanvasStroke(
    page: Page,
    from: { nx: number; ny: number },
    to: { nx: number; ny: number },
) {
    const canvas = page.getByTestId('shared-canvas-element')
    const bounds = await canvas.boundingBox()
    if (!bounds) throw new Error('Canvas bounds are not available')

    const fromX = bounds.x + bounds.width * from.nx
    const fromY = bounds.y + bounds.height * from.ny
    const toX = bounds.x + bounds.width * to.nx
    const toY = bounds.y + bounds.height * to.ny

    await page.mouse.move(fromX, fromY)
    await page.mouse.down()
    await page.mouse.move(toX, toY, { steps: 8 })
    await page.mouse.up()
}

async function canvasHasInkNear(page: Page, nx: number, ny: number): Promise<boolean> {
    return await page.getByTestId('shared-canvas-element').evaluate(
        (canvas, point) => {
            const context = canvas.getContext('2d')
            if (!context) return false
            const cx = Math.round(canvas.width * point.nx)
            const cy = Math.round(canvas.height * point.ny)
            const radius = 12
            const minX = Math.max(0, cx - radius)
            const maxX = Math.min(canvas.width - 1, cx + radius)
            const minY = Math.max(0, cy - radius)
            const maxY = Math.min(canvas.height - 1, cy + radius)

            const image = context.getImageData(minX, minY, maxX - minX + 1, maxY - minY + 1)
            for (let index = 0; index < image.data.length; index += 4) {
                const r = image.data[index]
                const g = image.data[index + 1]
                const b = image.data[index + 2]
                const a = image.data[index + 3]
                if (a > 0 && !(r === 255 && g === 255 && b === 255)) return true
            }
            return false
        },
        { nx, ny },
    )
}

test('@demo-smoke join modal routes to callee session path', async ({ page }) => {
    const assertNoUnexpectedErrors = collectUnexpectedBrowserErrors(page, 'join-modal')
    try {
        await openHome(page)

        await page.getByTestId('open-join-room-btn').click()
        await expect(page.getByTestId('join-room-submit-btn')).toBeDisabled()

        await page.getByTestId('join-room-input').fill('  room-join  ')
        await page.getByTestId('join-room-submit-btn').click()

        await expect(page).toHaveURL(/#\/attach\/callee\/room-join$/)
        await expect(page.getByTestId('session-page')).toBeVisible()
    } finally {
        assertNoUnexpectedErrors()
    }
})

test('@demo-smoke attach query redirect resolves to session route', async ({ page }) => {
    const assertNoUnexpectedErrors = collectUnexpectedBrowserErrors(page, 'attach-redirect')
    try {
        await page.goto('/#/attach?as=callee&room=redirect-room&strategy=native')

        await expect(page).toHaveURL(/#\/attach\/callee\/redirect-room\?strategy=native$/)
        await expect(page.getByTestId('session-page')).toBeVisible()
    } finally {
        assertNoUnexpectedErrors()
    }
})

test.describe('backend smoke @demo-smoke', () => {
    test.beforeAll(() => {
        if (HAS_SIGNALING_ENV) return
        throw new Error(
            'Missing Firebase signaling env vars: VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_API_KEY, VITE_FIREBASE_APP_ID',
        )
    })

    test('home create room routes to caller session', async ({ page }) => {
        const assertNoUnexpectedErrors = collectUnexpectedBrowserErrors(page, 'create-room')
        try {
            await openHome(page)
            await page.getByTestId('create-room-default-btn').click()
            await expect(page).toHaveURL(CALLER_ATTACH_URL_RE, {
                timeout: READY_TIMEOUT_MS,
            })
            await expect(page.getByTestId('session-page')).toBeVisible()
            const roomId = extractCallerRoomId(page.url())
            expect(roomId.length).toBeGreaterThan(0)
        } finally {
            assertNoUnexpectedErrors()
        }
    })

    test('home create room can be canceled from initialization modal', async ({ page }) => {
        const assertNoUnexpectedErrors = collectUnexpectedBrowserErrors(page, 'create-room-cancel')
        try {
            await openHome(page)
            await page.getByTestId('create-room-default-btn').click()
            await expect(page.getByTestId('create-room-overlay')).toBeVisible()

            await page.getByTestId('create-room-cancel-btn').click()

            await expect(page).toHaveURL(HOME_URL_RE)
            await expect(page.getByTestId('home-page')).toBeVisible()
            await expect(page.getByTestId('create-room-overlay')).toBeHidden()

            await page.waitForTimeout(3_000)
            await expect(page).toHaveURL(HOME_URL_RE)
            await expect(page).not.toHaveURL(CALLER_ATTACH_URL_RE)
        } finally {
            assertNoUnexpectedErrors()
        }
    })

    test('caller/callee exchange messages and follow updated leave behavior', async ({ browser }) => {
        const callerContext = await browser.newContext()
        const calleeContext = await browser.newContext()
        const callerPage = await callerContext.newPage()
        const calleePage = await calleeContext.newPage()
        const assertCallerErrors = collectUnexpectedBrowserErrors(callerPage, 'caller')
        const assertCalleeErrors = collectUnexpectedBrowserErrors(calleePage, 'callee')
        let pendingError: unknown

        try {
            await openHome(callerPage)
            await callerPage.getByTestId('create-room-default-btn').click()
            await expect(callerPage).toHaveURL(CALLER_ATTACH_URL_RE, {
                timeout: READY_TIMEOUT_MS,
            })

            const roomId = extractCallerRoomId(callerPage.url())

            await calleePage.goto(`/#/attach/callee/${encodeURIComponent(roomId)}`)
            await expect(calleePage.getByTestId('session-page')).toBeVisible()

            await waitMessagingReady(callerPage)
            await waitMessagingReady(calleePage)
            await expect(callerPage.getByTestId('callee-qr-modal')).toBeHidden()

            await callerPage.getByTestId('shared-canvas-toggle-btn').click()
            await expect(callerPage.getByTestId('shared-canvas-modal')).toBeVisible({
                timeout: READY_TIMEOUT_MS,
            })
            await expect(calleePage.getByTestId('shared-canvas-modal')).toBeVisible({
                timeout: READY_TIMEOUT_MS,
            })

            await drawCanvasStroke(
                callerPage,
                { nx: 0.28, ny: 0.32 },
                { nx: 0.56, ny: 0.46 },
            )
            await expect
                .poll(() => canvasHasInkNear(calleePage, 0.42, 0.4), {
                    timeout: READY_TIMEOUT_MS,
                })
                .toBe(true)

            await calleePage.getByTestId('shared-canvas-clear-btn').click()
            await expect
                .poll(() => canvasHasInkNear(calleePage, 0.42, 0.4), {
                    timeout: READY_TIMEOUT_MS,
                })
                .toBe(false)
            await expect
                .poll(() => canvasHasInkNear(callerPage, 0.42, 0.4), {
                    timeout: READY_TIMEOUT_MS,
                })
                .toBe(false)

            await drawCanvasStroke(
                calleePage,
                { nx: 0.62, ny: 0.24 },
                { nx: 0.34, ny: 0.58 },
            )
            await expect
                .poll(() => canvasHasInkNear(callerPage, 0.48, 0.41), {
                    timeout: READY_TIMEOUT_MS,
                })
                .toBe(true)

            await callerPage.getByTestId('shared-canvas-clear-btn').click()
            await expect
                .poll(() => canvasHasInkNear(calleePage, 0.48, 0.41), {
                    timeout: READY_TIMEOUT_MS,
                })
                .toBe(false)
            await expect
                .poll(() => canvasHasInkNear(callerPage, 0.48, 0.41), {
                    timeout: READY_TIMEOUT_MS,
                })
                .toBe(false)

            await calleePage.getByTestId('shared-canvas-modal-close').click()
            await expect(calleePage.getByTestId('shared-canvas-modal')).toBeHidden({
                timeout: READY_TIMEOUT_MS,
            })
            await expect(callerPage.getByTestId('shared-canvas-modal')).toBeHidden({
                timeout: READY_TIMEOUT_MS,
            })

            const fastMessage = `fast-${Date.now()}`
            await sendMessage(callerPage, 'fast', fastMessage)
            await expect(calleePage.getByTestId('operation-log-list')).toContainText(
                `Incoming fast message: ${fastMessage}`,
                { timeout: READY_TIMEOUT_MS },
            )

            const reliableMessage = `reliable-${Date.now()}`
            await sendMessage(calleePage, 'reliable', reliableMessage)
            await expect(callerPage.getByTestId('operation-log-list')).toContainText(
                `Incoming reliable message: ${reliableMessage}`,
                { timeout: READY_TIMEOUT_MS },
            )

            await calleePage.getByTestId('session-close-btn').click()
            await expect(calleePage.getByTestId('leave-session-modal')).toBeVisible()
            await expect(calleePage.getByTestId('leave-remove-room-checkbox-input')).toHaveCount(0)
            await calleePage.getByTestId('leave-session-confirm-btn').click()
            await expect(calleePage).toHaveURL(/#\/$/, { timeout: READY_TIMEOUT_MS })

            await expect(
                callerPage,
            ).toHaveURL(new RegExp(`#\\/attach\\/caller\\/${roomId}(?:\\?.*)?$`), {
                timeout: READY_TIMEOUT_MS,
            })
            await expect(callerPage.getByTestId('callee-qr-modal')).toBeVisible({
                timeout: READY_TIMEOUT_MS,
            })
            await callerPage.getByTestId('callee-qr-modal-close').click()

            await callerPage.getByTestId('session-close-btn').click()
            await expect(callerPage.getByTestId('leave-session-modal')).toBeVisible()
            await expect(callerPage.getByTestId('leave-remove-room-checkbox-input')).toBeChecked()
            await expect(callerPage.getByTestId('leave-session-message')).toContainText(
                'Room will be removed.',
            )
            await callerPage.getByTestId('leave-session-confirm-btn').click()
            await expect(callerPage).toHaveURL(/#\/$/, { timeout: READY_TIMEOUT_MS })
        } catch (error) {
            pendingError = error
        } finally {
            try {
                assertCallerErrors()
                assertCalleeErrors()
            } catch (error) {
                if (!pendingError) pendingError = error
            }
            await Promise.all([
                calleeContext.close().catch(() => {}),
                callerContext.close().catch(() => {}),
            ])
            if (pendingError) throw pendingError
        }
    })
})
