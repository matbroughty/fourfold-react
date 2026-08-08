import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Admin from './pages/Admin'
import Home from './pages/Home'
import Rounds from './pages/Rounds'
import Seasons from './pages/Seasons'

function Nav() {
  const { pathname } = useLocation()
  const isActive = (path: string) =>
    path === '/' ? pathname === '/' : pathname.startsWith(path)

  return (
    <nav className="nav">
      {[
        ['/', 'Table'],
        ['/rounds', 'Rounds'],
        ['/seasons', 'Seasons'],
        ['/admin', 'Admin'],
      ].map(([path, label]) => (
        <Link key={path} to={path} className={isActive(path) ? 'nav-link nav-active' : 'nav-link'}>
          {label}
        </Link>
      ))}
    </nav>
  )
}

export default function App() {
  return (
    <div className="container">
      <header className="header">
        <div>
          <h1>FourFold</h1>
          <p className="subtle tagline">
            Five from Sky’s Super 6, backed as five £1 fourfolds.
          </p>
        </div>
        <Nav />
      </header>

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/rounds" element={<Rounds />} />
        <Route path="/seasons" element={<Seasons />} />
        <Route path="/seasons/:seasonId" element={<Seasons />} />
        <Route path="/seasons/:seasonId/rounds" element={<Rounds />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <footer className="footer subtle">
        FourFold · run by Mat Broughton · £5 a round, five fourfolds from five picks
      </footer>
    </div>
  )
}
