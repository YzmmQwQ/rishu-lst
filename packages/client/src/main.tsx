import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './components/player-icons/icon-animations.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
