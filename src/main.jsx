import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';
import './App.css';
import Layout from './Layout.jsx';
import Home from './pages/Home.jsx';
import Historia from './pages/Historia.jsx';
import LaOrilla from './pages/LaOrilla.jsx';
import Manifiesto from './pages/Manifiesto.jsx';
import Equipos from './pages/Equipos.jsx';
import HazteSocio from './pages/HazteSocio.jsx';
import Himno from './pages/Himno.jsx';
import Lola from './pages/Lola.jsx';
import Bombonera from './pages/Bombonera.jsx';
import Tienda from './pages/Tienda.jsx';
import Noticias from './pages/Noticias.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="historia" element={<Historia />} />
          <Route path="la-orilla" element={<LaOrilla />} />
          <Route path="manifiesto" element={<Manifiesto />} />
          <Route path="equipos" element={<Equipos />} />
          <Route path="hazte-socio" element={<HazteSocio />} />
          <Route path="himno" element={<Himno />} />
          <Route path="lola" element={<Lola />} />
          <Route path="bombonera" element={<Bombonera />} />
          <Route path="tienda" element={<Tienda />} />
          <Route path="noticias" element={<Noticias />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
