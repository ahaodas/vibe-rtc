import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useVibeRTC, VibeRTCProvider } from '../context'
import { createMockSignalDB } from './test-utils'

describe('useVibeRTC', () => {
	it('throws error when used outside provider', () => {
		function TestComponent() {
			useVibeRTC()
			return <div>Test</div>
		}

		// Suppress console.error for this test since we expect an error
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

		expect(() => render(<TestComponent />)).toThrow('VibeRTCProvider missing')

		consoleSpy.mockRestore()
	})

	it('returns context value when used inside provider', () => {
		const mockSignalDB = createMockSignalDB()
		let contextValue: ReturnType<typeof useVibeRTC> | null = null

		function TestComponent() {
			contextValue = useVibeRTC()
			return <div>Test</div>
		}

		render(
			<VibeRTCProvider signalServer={mockSignalDB}>
				<TestComponent />
			</VibeRTCProvider>,
		)

		expect(contextValue).not.toBeNull()
		expect(contextValue).toHaveProperty('createChannel')
		expect(contextValue).toHaveProperty('joinChannel')
		expect(contextValue).toHaveProperty('disconnect')
		expect(contextValue).toHaveProperty('endRoom')
		expect(contextValue).toHaveProperty('sendFast')
		expect(contextValue).toHaveProperty('sendReliable')
		expect(contextValue).toHaveProperty('reconnectSoft')
		expect(contextValue).toHaveProperty('reconnectHard')
		expect(contextValue).toHaveProperty('attachAsCaller')
		expect(contextValue).toHaveProperty('attachAsCallee')
		expect(contextValue).toHaveProperty('attachAuto')
		expect(contextValue).toHaveProperty('status')
		expect(contextValue).toHaveProperty('overallStatus')
		expect(contextValue).toHaveProperty('overallStatusText')
		expect(contextValue).toHaveProperty('operationLog')
		expect(contextValue).toHaveProperty('clearOperationLog')
	})
})
