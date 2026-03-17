import { expect, test, type Page } from '@playwright/test'

const READY_TIMEOUT_MS = 45_000
const HAS_SIGNALING_ENV =
    Boolean(process.env.VITE_FIREBASE_PROJECT_ID) &&
    Boolean(process.env.VITE_FIREBASE_API_KEY) &&
    Boolean(process.env.VITE_FIREBASE_APP_ID)

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

test('@demo-smoke join modal routes to callee session path', async ({ page }) => {
    await openHome(page)

    await page.getByTestId('open-join-room-btn').click()
    await expect(page.getByTestId('join-room-submit-btn')).toBeDisabled()

    await page.getByTestId('join-room-input').fill('  room-join  ')
    await page.getByTestId('join-room-submit-btn').click()

    await expect(page).toHaveURL(/#\/attach\/callee\/room-join$/)
    await expect(page.getByTestId('session-page')).toBeVisible()
})

test('@demo-smoke attach query redirect resolves to session route', async ({ page }) => {
    await page.goto('/#/attach?as=callee&room=redirect-room&strategy=native')

    await expect(page).toHaveURL(/#\/attach\/callee\/redirect-room\?strategy=native$/)
    await expect(page.getByTestId('session-page')).toBeVisible()
})

test.describe('backend smoke @demo-smoke', () => {
    test.skip(
        !HAS_SIGNALING_ENV,
        'Requires Firebase signaling env vars: VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_API_KEY, VITE_FIREBASE_APP_ID',
    )

    test('home create room routes to caller session', async ({ page }) => {
        await openHome(page)

        await page.getByTestId('create-room-default-btn').click()

        await expect(page).toHaveURL(/#\/attach\/caller\/[^?]+$/, {
            timeout: READY_TIMEOUT_MS,
        })
        await expect(page.getByTestId('session-page')).toBeVisible()
        expect(extractCallerRoomId(page.url()).length).toBeGreaterThan(0)
    })

    test('caller/callee exchange messages and follow updated leave behavior', async ({ browser }) => {
        const callerContext = await browser.newContext()
        const calleeContext = await browser.newContext()
        const callerPage = await callerContext.newPage()
        const calleePage = await calleeContext.newPage()

        try {
            await openHome(callerPage)
            await callerPage.getByTestId('create-room-default-btn').click()
            await expect(callerPage).toHaveURL(/#\/attach\/caller\/[^?]+$/, {
                timeout: READY_TIMEOUT_MS,
            })

            const roomId = extractCallerRoomId(callerPage.url())

            await calleePage.goto(`/#/attach/callee/${encodeURIComponent(roomId)}`)
            await expect(calleePage.getByTestId('session-page')).toBeVisible()

            await waitMessagingReady(callerPage)
            await waitMessagingReady(calleePage)
            await expect(callerPage.getByTestId('callee-qr-modal')).toBeHidden()

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

            await expect(callerPage).toHaveURL(new RegExp(`#\\/attach\\/caller\\/${roomId}$`), {
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
        } finally {
            await Promise.all([
                calleeContext.close().catch(() => {}),
                callerContext.close().catch(() => {}),
            ])
        }
    })
})
