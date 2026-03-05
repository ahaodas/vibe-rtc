import { createRoot } from 'react-dom/client'
import { App } from '@/app/App'
import { RTCProvider } from '@/app/providers/RTCProvider'
import '@/styles.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
    throw new Error('Root element "#root" not found')
}

createRoot(rootElement).render(
    <RTCProvider>
        <App />
    </RTCProvider>,
)
