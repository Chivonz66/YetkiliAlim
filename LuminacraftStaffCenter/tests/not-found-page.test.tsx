import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import App from '../src/App'
import NotFoundPage from '../src/pages/NotFoundPage'

afterEach(() => {
  cleanup()
  window.history.pushState({}, '', '/')
})

describe('NotFoundPage', () => {
  it('bilinmeyen yolda Türkçe 404 içeriği ve ana sayfa bağlantısı gösterir', () => {
    window.history.pushState({}, '', '/bu-sayfa-yok')
    render(
      <BrowserRouter>
        <Routes>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>,
    )

    expect(screen.getByRole('heading', { name: /Bu sayfayı bulamadık/i })).toBeTruthy()
    expect(screen.getByText(/404 \/ Sayfa bulunamadı/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: /Ana sayfaya dön/i }).getAttribute('href')).toBe('/')
  })

  it('App yönlendirmesi eşleşmeyen derin bağlantıyı 404 sayfasına düşürür', async () => {
    window.history.pushState({}, '', '/bu-sayfa-yok')
    render(<App />)

    expect(await screen.findByRole('heading', { name: /Bu sayfayı bulamadık/i })).toBeTruthy()
    expect(document.querySelector('#root')).toBeNull()
    expect(document.body.textContent?.length).toBeGreaterThan(0)
  })
})
