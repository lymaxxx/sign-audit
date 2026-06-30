import Crest from './assets/Crest.jsx';
import './App.css';

const ANTHEM_VERSES = [
  {
    title: 'Verso 1',
    lines: [
      'Desde la orilla del río marrón',
      'late en mi pecho un solo corazón,',
      'de barro y de hierro, de niebla y de sal,',
      'Riachuelo, mi club, mi bandera, mi hogar.',
    ],
  },
  {
    title: 'Estribillo',
    lines: [
      '¡Vamos, Riachuelo, que la hinchada cantó!',
      'Por vos doy la vida, por vos late el tambor.',
      'Oh-oh-oh-oh, la orilla gritó,',
      'mientras corra ese río, ¡jamás te dejo yo!',
    ],
  },
  {
    title: 'Verso 2',
    lines: [
      'Once guerreros pintados de honor,',
      'cada domingo me parte el amor,',
      'gano o pierdo, igual te he de seguir,',
      'con esta camiseta yo aprendí a vivir.',
    ],
  },
  { title: '(Estribillo)', lines: [] },
  {
    title: 'Puente',
    lines: [
      'La Boca me vio nacer,',
      'el puerto me vio crecer,',
      'y aunque pase la vida entera',
      '¡Riachuelo, vuelvo a volver!',
    ],
  },
  { title: '(Estribillo, todos juntos)', lines: [] },
];

function NavBar() {
  return (
    <header className="navbar">
      <div className="navbar-inner">
        <div className="brand">
          <Crest size={40} />
          <span className="brand-name">Riachuelo</span>
        </div>
        <nav>
          <a href="#historia">Historia</a>
          <a href="#identidad">Identidad</a>
          <a href="#himno">Himno</a>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="hero">
      <div className="hero-bg" aria-hidden="true" />
      <div className="hero-content">
        <Crest size={170} />
        <h1 className="hero-title">Club Atlético de Riachuelo</h1>
        <p className="hero-tagline">Fundado en 1913 · La Boca del Riachuelo</p>
        <div className="hero-actions">
          <a className="btn btn-primary" href="#himno">
            Escuchar el himno
          </a>
          <a className="btn btn-ghost" href="#historia">
            Conocer la historia
          </a>
        </div>
      </div>
    </section>
  );
}

function History() {
  return (
    <section id="historia" className="section">
      <h2 className="section-title">Historia</h2>
      <div className="history-grid">
        <p>
          Nacido en 1913 a orillas del Riachuelo, el club surgió del trabajo de
          estibadores, ferroviarios y mecánicos del puerto. Su escudo —un ave
          zancuda forjada en hierro y bronce— representa la fusión entre la
          naturaleza del río y la industria que dio vida al barrio.
        </p>
        <p>
          Desde sus primeros partidos en potreros de tierra hasta hoy, el club
          mantuvo su identidad obrera: disciplina, resistencia y un fuerte
          lazo con la hinchada que lo acompaña cada domingo, llueva o truene,
          como las garzas que resisten la niebla del puerto.
        </p>
      </div>
      <ul className="timeline">
        <li>
          <span className="timeline-year">1913</span>
          Fundación del club por trabajadores del puerto de Riachuelo.
        </li>
        <li>
          <span className="timeline-year">1928</span>
          Primer título de la liga local, consagrando el escudo del Garza de Hierro.
        </li>
        <li>
          <span className="timeline-year">1957</span>
          Inauguración del estadio a metros del río que le da nombre al club.
        </li>
        <li>
          <span className="timeline-year">Hoy</span>
          Una hinchada fiel sigue cantando el himno en cada cancha del país.
        </li>
      </ul>
    </section>
  );
}

function Identity() {
  return (
    <section id="identidad" className="section section-alt">
      <h2 className="section-title">Identidad</h2>
      <div className="identity-grid">
        <div className="identity-card">
          <h3>El escudo</h3>
          <p>
            Una garza mecánica, mitad ave mitad máquina portuaria, enmarcada
            por engranajes que recuerdan los talleres ferroviarios donde
            nació el club.
          </p>
        </div>
        <div className="identity-card">
          <h3>Los colores</h3>
          <div className="swatches">
            <div className="swatch" style={{ background: 'var(--teal)' }}>
              Verde río
            </div>
            <div className="swatch" style={{ background: 'var(--red)' }}>
              Rojo hierro
            </div>
            <div className="swatch" style={{ background: 'var(--cream)', color: 'var(--ink)' }}>
              Crema niebla
            </div>
          </div>
        </div>
        <div className="identity-card">
          <h3>El mascota</h3>
          <p>
            <strong>El Garza de Hierro</strong>: un ave zancuda robótica que
            patrulla la orilla del Riachuelo, símbolo de paciencia,
            precisión y fuerza industrial.
          </p>
        </div>
      </div>
    </section>
  );
}

function Anthem() {
  return (
    <section id="himno" className="section">
      <h2 className="section-title">Himno del Riachuelo</h2>
      <div className="anthem-player">
        <audio controls src="/audio/himno-riachuelo.mp3">
          Tu navegador no soporta el elemento de audio.
        </audio>
      </div>
      <div className="anthem-lyrics">
        {ANTHEM_VERSES.map((verse) => (
          <div className="anthem-verse" key={verse.title}>
            <h3>{verse.title}</h3>
            {verse.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <Crest size={48} />
      <p>Club Atlético de Riachuelo · Fundado en 1913</p>
    </footer>
  );
}

export default function App() {
  return (
    <div className="page">
      <NavBar />
      <Hero />
      <History />
      <Identity />
      <Anthem />
      <Footer />
    </div>
  );
}
