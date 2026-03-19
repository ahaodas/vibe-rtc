import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { DEMO_ROUTE_PATHS } from '@/features/demo/model/routePaths'
import { AttachQueryRedirectPage } from '@/features/demo/pages/AttachQueryRedirectPage'

function SessionProbe() {
    const { role, roomId } = useParams()
    const location = useLocation()

    return (
        <div data-testid="session-route">
            <span data-testid="session-role">{role}</span>
            <span data-testid="session-room-id">{roomId}</span>
            <span data-testid="session-search">{location.search}</span>
        </div>
    )
}

function renderAt(path: string) {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path={DEMO_ROUTE_PATHS.home} element={<div data-testid="home-route" />} />
                <Route path={DEMO_ROUTE_PATHS.attach} element={<AttachQueryRedirectPage />} />
                <Route path={DEMO_ROUTE_PATHS.attachSession} element={<SessionProbe />} />
                <Route path={DEMO_ROUTE_PATHS.wildcard} element={<div data-testid="no-match" />} />
            </Routes>
        </MemoryRouter>,
    )
}

describe('AttachQueryRedirectPage', () => {
    it('redirects to home when role is missing', () => {
        renderAt('/attach?roomId=room-1')
        expect(screen.getByTestId('home-route')).toBeInTheDocument()
    })

    it('redirects to home when room id is missing or blank', () => {
        renderAt('/attach?role=caller&roomId=%20%20%20')
        expect(screen.getByTestId('home-route')).toBeInTheDocument()
    })

    it('accepts legacy aliases "as" and "room"', () => {
        renderAt('/attach?as=callee&room=legacy-room')
        expect(screen.getByTestId('session-role')).toHaveTextContent('callee')
        expect(screen.getByTestId('session-room-id')).toHaveTextContent('legacy-room')
        expect(screen.getByTestId('session-search')).toHaveTextContent('')
    })

    it('prioritizes role/roomId over as/room when both are present', () => {
        renderAt('/attach?role=caller&as=callee&roomId=primary&room=legacy')
        expect(screen.getByTestId('session-role')).toHaveTextContent('caller')
        expect(screen.getByTestId('session-room-id')).toHaveTextContent('primary')
    })

    it('keeps native strategy in redirected query string', () => {
        renderAt('/attach?role=caller&roomId=room-1&strategy=native')
        expect(screen.getByTestId('session-role')).toHaveTextContent('caller')
        expect(screen.getByTestId('session-room-id')).toHaveTextContent('room-1')
        expect(screen.getByTestId('session-search')).toHaveTextContent('?strategy=native')
    })

    it('forwards optional sessionId to session route', () => {
        renderAt('/attach?role=callee&roomId=room-2&sessionId=session-2')
        expect(screen.getByTestId('session-role')).toHaveTextContent('callee')
        expect(screen.getByTestId('session-room-id')).toHaveTextContent('room-2')
        expect(screen.getByTestId('session-search')).toHaveTextContent('?sessionId=session-2')
    })
})
