import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminToastProvider } from '../src/components/admin/AdminLayout'
import SettingsPage from '../src/pages/admin/SettingsPage'
import { getSettings, updateSettings } from '../src/lib/api-admin'

vi.mock('../src/lib/api-admin', () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  listApplications: vi.fn(async () => ({ applications: [], total: 0, limit: 1, offset: 0 })),
  logoutAdmin: vi.fn(async () => ({ ok: true })),
}))

describe('Ayarlar - saatlik başvuru sınırı doğrulaması', () => {
  beforeEach(() => {
    vi.mocked(getSettings).mockResolvedValue({
      applications_open: true,
      closed_message: 'Kapalı.',
      rate_limit_per_ip_per_hour: 5,
      site_title: 'Luminacraft Staff Center',
      discord_enabled: false,
    })
    vi.mocked(updateSettings).mockResolvedValue({})
  })

  afterEach(() => {
    cleanup()
  })

  it('geçersiz sınırda doğrulama bildirimi gösterir ve ayarları değiştirmez', async () => {
    render(
      <AdminToastProvider>
        <SettingsPage />
      </AdminToastProvider>,
    )

    const limitInput = await screen.findByLabelText('Saatlik başvuru sınırı (IP)')
    const form = limitInput.closest('form')
    expect(form).not.toBeNull()
    // Tarayıcının yerel kısıt doğrulaması submit olayını engellemesin;
    // uygulamanın kendi doğrulaması çalışıp bildirim göstersin.
    expect(form?.noValidate).toBe(true)

    fireEvent.change(limitInput, { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: /Sistem ayarlarını kaydet/i }))

    await waitFor(() => {
      expect(screen.getByText('Hız sınırı 1 ile 1000 arasında olmalıdır.')).toBeTruthy()
    })
    expect(updateSettings).not.toHaveBeenCalled()
  })
})
