import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom'
import { DEMO_ROUTE_PATHS } from '@/features/demo/model/routePaths'
import { AttachQueryRedirectPage } from '@/features/demo/pages/AttachQueryRedirectPage'
import { HomePage } from '@/features/demo/pages/HomePage'
import { SessionPage } from '@/features/demo/pages/SessionPage'

const router = createHashRouter([
    {
        path: DEMO_ROUTE_PATHS.home,
        element: <HomePage />,
    },
    {
        path: DEMO_ROUTE_PATHS.attachSession,
        element: <SessionPage />,
    },
    {
        path: DEMO_ROUTE_PATHS.attach,
        element: <AttachQueryRedirectPage />,
    },
    {
        path: DEMO_ROUTE_PATHS.wildcard,
        element: <Navigate to={DEMO_ROUTE_PATHS.home} replace />,
    },
])

export function AppRouter() {
    return <RouterProvider router={router} />
}
