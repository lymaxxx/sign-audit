import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import Crest from './assets/Crest.jsx';
import RiverMeander from './assets/RiverMeander.jsx';
import { LangContext, useLangState } from './lang.js';

const NAV_LINKS = [
  { to: '/historia', es: 'Historia', en: 'Story' },
  { to: '/la-orilla', es: 'La Orilla', en: 'The Riverbank' },
  { to: '/manifiesto', es: 'Manifiesto', en: 'Manifesto' },
  { to: '/equipos', es: 'Equipos', en: 'Teams' },
  { to: '/himno', es: 'El Himno', en: 'Anthem' },
  { to: '/lola', es: 'Lola la Grúa', en: 'Lola' },
  { to: '/bombonera', es: 'La Bombonera del Río', en: 'Stadium' },
  { to: '/tienda', es: 'Tienda', en: 'Shop' },
  { to: '/noticias', es: 'Noticias', en: 'News' },
];

export default function Layout() {
  const langState = useLangState();
  const { lang, setLang, t } = langState;

  return (
    <LangContext.Provider value={langState}>
      <div className="page">
        <header className="navbar">
          <div className="navbar-inner">
            <NavLink to="/" className="brand" aria-label="Inicio">
              <Crest size={40} />
              <span className="brand-name">Riachuelo</span>
            </NavLink>
            <nav className="navbar-nav">
              {NAV_LINKS.map((link) => (
                <NavLink key={link.to} to={link.to} className="nav-link">
                  {t(link)}
                </NavLink>
              ))}
            </nav>
            <div className="navbar-actions">
              <button
                type="button"
                className="lang-toggle"
                onClick={() => setLang(lang === 'es' ? 'en' : 'es')}
                aria-label="Cambiar idioma / Switch language"
              >
                {lang === 'es' ? 'EN' : 'ES'}
              </button>
              <NavLink to="/hazte-socio" className="btn btn-primary btn-sm">
                {t({ es: 'Hazte Socio', en: 'Become a Member' })}
              </NavLink>
            </div>
          </div>
        </header>

        <main className="main">
          <Outlet />
        </main>

        <footer className="footer">
          <RiverMeander className="footer-river" />
          <div className="footer-inner">
            <div className="footer-brand">
              <Crest size={56} />
              <p>Fund. 1913</p>
            </div>
            <div className="footer-columns">
              <div>
                <h4>{t({ es: 'Club', en: 'Club' })}</h4>
                <NavLink to="/historia">{t({ es: 'Historia', en: 'Story' })}</NavLink>
                <NavLink to="/manifiesto">{t({ es: 'Manifiesto', en: 'Manifesto' })}</NavLink>
              </div>
              <div>
                <h4>{t({ es: 'Hinchada', en: 'Supporters' })}</h4>
                <NavLink to="/hazte-socio">{t({ es: 'Hazte Socio', en: 'Membership' })}</NavLink>
                <NavLink to="/himno">{t({ es: 'El Himno', en: 'Anthem' })}</NavLink>
                <NavLink to="/lola">Lola la Grúa</NavLink>
              </div>
              <div>
                <h4>{t({ es: 'Tienda', en: 'Shop' })}</h4>
                <NavLink to="/tienda">{t({ es: 'Ver todo', en: 'Shop all' })}</NavLink>
              </div>
              <div>
                <h4>{t({ es: 'Legal', en: 'Legal' })}</h4>
                <span>{t({ es: 'Términos', en: 'Terms' })}</span>
                <span>{t({ es: 'Privacidad', en: 'Privacy' })}</span>
              </div>
            </div>
            <div className="footer-social">
              <span className="social-dot" />
              <span className="social-dot" />
              <span className="social-dot" />
            </div>
          </div>
          <p className="footer-creed">
            {t({ es: 'No somos la marca, somos la fe.', en: "We're not the brand, we're the faith." })}
          </p>
        </footer>
      </div>
    </LangContext.Provider>
  );
}
