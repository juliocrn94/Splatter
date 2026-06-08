import Link from 'next/link'

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="mb-14">
    <h2 className="text-lg font-semibold text-white mb-5 pb-2 border-b border-gray-800">{title}</h2>
    {children}
  </section>
)

const Tip = ({ icon, title, body }: { icon: string; title: string; body: string }) => (
  <div className="flex gap-4 py-3">
    <span className="text-xl w-7 flex-shrink-0">{icon}</span>
    <div>
      <p className="text-white text-sm font-medium">{title}</p>
      <p className="text-gray-400 text-sm mt-0.5">{body}</p>
    </div>
  </div>
)

const Warning = ({ children }: { children: React.ReactNode }) => (
  <div className="bg-red-950/30 border border-red-800/50 rounded-xl p-4 text-sm text-red-300">
    {children}
  </div>
)

const Good = ({ children }: { children: React.ReactNode }) => (
  <div className="bg-green-950/30 border border-green-800/50 rounded-xl p-4 text-sm text-green-300">
    {children}
  </div>
)

export default function GuiaPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-2xl mx-auto px-6 py-12">

        {/* Header */}
        <div className="mb-12">
          <Link href="/" className="text-gray-500 hover:text-gray-300 text-sm">← Proyectos</Link>
          <h1 className="text-2xl font-bold mt-4">Cómo grabar para mejores tours 3D</h1>
          <p className="text-gray-400 mt-2">
            Guía práctica para obtener reconstrucciones de alta calidad con Gaussian Splatting.
          </p>
        </div>

        {/* Checklist rápido */}
        <Section title="Checklist antes de grabar">
          <div className="bg-gray-900 rounded-xl border border-gray-800 divide-y divide-gray-800">
            {[
              'Enciende todas las luces del espacio',
              'Cierra persianas si hay ventanas con luz directa del sol',
              'Apaga ventiladores y abre o cierra cortinas para que no se muevan',
              'Saca personas, mascotas y objetos que puedan moverse',
              'Cubre espejos grandes con tela o papel mate si es posible',
              'Apaga o cubre pantallas de TV',
              'Bloquea la exposición automática del celular antes de empezar',
              'Haz una caminata de prueba para identificar zonas problemáticas',
            ].map((item) => (
              <label key={item} className="flex items-start gap-3 px-5 py-3.5 cursor-pointer hover:bg-gray-800/40 transition-colors">
                <input type="checkbox" className="mt-0.5 accent-violet-500 flex-shrink-0" />
                <span className="text-gray-300 text-sm">{item}</span>
              </label>
            ))}
          </div>
        </Section>

        {/* Movimiento de cámara */}
        <Section title="Movimiento de cámara">
          <div className="space-y-1 divide-y divide-gray-800/60">
            <Tip
              icon="🐢"
              title="Muévete a la mitad de tu velocidad normal"
              body="El movimiento rápido genera motion blur aunque el celular tenga estabilización óptica. Tómate tu tiempo."
            />
            <Tip
              icon="🔄"
              title="Patrón: perímetro → cruce → detalles"
              body="Primero camina lentamente pegado a las paredes. Luego cruza el cuarto en diagonal. Por último acércate a muebles y elementos clave."
            />
            <Tip
              icon="📐"
              title="Varía la altura de la cámara"
              body="Captura a tres alturas: baja (~0.5m hacia el piso), media (~1.3m, nivel de ojos) y alta (~2m hacia el techo). Inclina la cámara arriba y abajo durante cada pasada."
            />
            <Tip
              icon="🚪"
              title="Pasa las puertas varias veces"
              body="Los umbrales son zonas críticas. Pasa cada puerta al menos dos veces desde ángulos ligeramente distintos. Reduce la velocidad al máximo en transiciones entre cuartos."
            />
            <Tip
              icon="🔁"
              title="Regresa al punto de inicio"
              body="Termina la grabación cerca de donde empezaste. Esto ayuda al algoritmo de reconstrucción a cerrar el modelo y reduce el drift en espacios grandes."
            />
            <Tip
              icon="📏"
              title="Mantén 0.5–1.5m de distancia a las paredes"
              body="Muy cerca pierde profundidad y detalle. Muy lejos no captura la textura. La distancia ideal es el largo de un brazo extendido."
            />
          </div>
        </Section>

        {/* Iluminación */}
        <Section title="Iluminación">
          <div className="space-y-4">
            <Good>
              <p className="font-medium text-green-200 mb-1">La consistencia importa más que el brillo</p>
              <p>Una habitación uniformemente iluminada aunque sea tenue reconstruye mucho mejor que una brillante pero con zonas oscuras o sombras duras.</p>
            </Good>
            <div className="space-y-1 divide-y divide-gray-800/60">
              <Tip
                icon="💡"
                title="Enciende todas las luces interiores"
                body="Techo, lámparas, luces de gabinete, bajo-mueble. Cuantas más, mejor distribución."
              />
              <Tip
                icon="🌤"
                title="Controla la luz de ventanas"
                body="Cierra las persianas parcialmente si el sol entra directamente. Las ventanas sobreexpuestas crean 'huecos blancos' en la reconstrucción."
              />
              <Tip
                icon="🔒"
                title="Bloquea la exposición automática"
                body="Antes de grabar: toca la pantalla para enfocar, luego mantén presionado hasta que aparezca 'AE/AF Lock' (iPhone) o el candado (Android). La exposición variable entre frames corrompe el algoritmo."
              />
              <Tip
                icon="🎞"
                title="Velocidad de obturador mínima 1/125s"
                body="En modo manual o Pro: usa al menos 1/125s. Idealmente 1/250s. Con 5 frames borrosos puedes arruinar toda la reconstrucción."
              />
            </div>
          </div>
        </Section>

        {/* Números de referencia */}
        <Section title="Referencia técnica">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Superposición entre frames', value: '70–80%' },
              { label: 'Frames objetivo (cuarto)', value: '200–400' },
              { label: 'Frames objetivo (depto completo)', value: '400–600' },
              { label: 'Mínimo absoluto de frames', value: '50' },
              { label: 'Extracción de video', value: '2–3 FPS' },
              { label: 'Velocidad de obturador mínima', value: '1/125s' },
              { label: 'Resolución recomendada', value: '4K' },
              { label: 'Lente a usar', value: 'Principal (1x)' },
            ].map(({ label, value }) => (
              <div key={label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="text-gray-400 text-xs mb-1">{label}</p>
                <p className="text-violet-300 font-semibold text-lg">{value}</p>
              </div>
            ))}
          </div>
          <p className="text-gray-600 text-xs mt-3">
            Basado en literatura de fotogrametría y comunidad de Gaussian Splatting.
          </p>
        </Section>

        {/* Lo que falla */}
        <Section title="Qué falla y por qué">
          <div className="space-y-3">
            <Warning>
              <p className="font-medium text-red-200 mb-1">Espejos y superficies reflexivas</p>
              <p>El algoritmo interpreta el reflejo como geometría real detrás del espejo. Genera artefactos severos. La solución más efectiva es cubrir los espejos antes de grabar.</p>
            </Warning>
            <Warning>
              <p className="font-medium text-red-200 mb-1">Vidrios y superficies transparentes</p>
              <p>Ventanas, mesas de vidrio, puertas de cristal, regaderas. El algoritmo no puede separar reflexión de transmisión. Captura en ángulo oblicuo (~45°), nunca de frente directo.</p>
            </Warning>
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left text-gray-500 font-normal px-4 py-3">Problema</th>
                    <th className="text-left text-gray-500 font-normal px-4 py-3">Causa</th>
                    <th className="text-left text-gray-500 font-normal px-4 py-3">Solución</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {[
                    ['Fantasmas / smearing', 'Movimiento rápido o blur', 'Reducir velocidad, obturador ≥1/125s'],
                    ['COLMAP falla', 'Pocos frames o sin overlap', 'Más cobertura, objetivo 200+ frames'],
                    ['Huecos en paredes', 'Pared blanca sin textura', 'Capturar desde más ángulos'],
                    ['Escena separada en dos nubes', 'Sin cobertura en puerta/umbral', 'Pasar puertas múltiples veces'],
                    ['Esquinas oscuras vacías', 'Sin luz ni features detectables', 'Iluminar con linterna antes de grabar'],
                    ['Techo/piso ausentes', 'Solo grabó horizontal', 'Inclinar cámara arriba y abajo'],
                    ['Patrón de azulejos confundido', 'Patrón repetitivo', 'Variar altura, agregar contexto visual'],
                  ].map(([p, c, s]) => (
                    <tr key={p} className="text-gray-300">
                      <td className="px-4 py-3 text-red-400 font-medium">{p}</td>
                      <td className="px-4 py-3 text-gray-400">{c}</td>
                      <td className="px-4 py-3 text-green-400">{s}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Section>

        {/* Celulares recomendados */}
        <Section title="Celulares y lentes">
          <div className="space-y-1 divide-y divide-gray-800/60">
            <Tip
              icon="📱"
              title="Usa el lente principal (1x)"
              body="No uses el gran angular (0.5x en iPhone). La distorsión del ultra-wide confunde el algoritmo de reconstrucción."
            />
            <Tip
              icon="✅"
              title="Celulares recomendados"
              body="iPhone 11 o posterior · Google Pixel 7 o posterior · Samsung Galaxy S22 o posterior. Todos pueden grabar 4K/30fps con estabilización."
            />
            <Tip
              icon="🎥"
              title="Configuración de video"
              body="4K a 30fps. Activa la estabilización óptica o electrónica. En modo Pro/Manual: ISO 100–400, apertura f/8–f/11 si es ajustable."
            />
            <Tip
              icon="🚫"
              title="Evita H.265 a baja tasa de bits"
              body="La compresión agresiva elimina la textura fina que COLMAP necesita para detectar features. Usa el modo 'Alta eficiencia' solo si tienes suficiente espacio de almacenamiento."
            />
          </div>
        </Section>

        {/* Expectativas */}
        <Section title="Expectativas realistas">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3 text-sm text-gray-400">
            <p>
              <span className="text-white font-medium">Espejos y vidrio no se reconstruyen con precisión.</span>
              {' '}Es una limitación fundamental del algoritmo, no del operador. El tour puede verse muy bien en general aunque estas zonas tengan artefactos.
            </p>
            <p>
              <span className="text-white font-medium">Calidad visual no garantiza precisión geométrica.</span>
              {' '}Un splat puede verse fotorrealista pero tener geometría incorrecta en zonas reflexivas o transparentes.
            </p>
            <p>
              <span className="text-white font-medium">Propiedades muy grandes requieren más cuidado.</span>
              {' '}En multi-nivel o más de 200m², el algoritmo puede acumular drift sin puntos de cierre de loop. Grabar por secciones y tener zonas de transición bien cubiertas ayuda.
            </p>
            <p>
              <span className="text-white font-medium">Tiempo de procesamiento: 20–90 minutos.</span>
              {' '}Depende del número de frames y modo de calidad (standard vs alta calidad).
            </p>
          </div>
        </Section>

        {/* CTA */}
        <div className="flex gap-3">
          <Link
            href="/nuevo"
            className="bg-violet-600 hover:bg-violet-500 text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-colors"
          >
            Crear proyecto
          </Link>
          <Link
            href="/"
            className="border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-white px-5 py-2.5 rounded-lg text-sm transition-colors"
          >
            Ver proyectos
          </Link>
        </div>

      </div>
    </div>
  )
}
