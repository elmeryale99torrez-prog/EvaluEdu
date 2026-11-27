import React, { useId } from 'react'

export type FlameBotMood = 'idle' | 'hover' | 'dragging' | 'happy' | 'thinking'

export interface FlameBot3DProps {
  size?: number
  mood?: FlameBotMood
  /** Desplazamiento sutil de mirada en X (-1 a 1) */
  lookX?: number
  /** Desplazamiento sutil de mirada en Y (-1 a 1) */
  lookY?: number
  /** Inclinación 3D en grados al arrastrar */
  tiltDeg?: number
  /** Mostrar sombra elíptica flotante debajo */
  showFloorShadow?: boolean
  className?: string
}

/**
 * Avatar 3D volumétrico y animado de la mini flama de EvaluEdu.
 * - Múltiples capas de volumen 3D (luz especular, halo cálido posterior, núcleo incandescente).
 * - Micro-animación orgánica de llama viva, parpadeo natural, chispas orbitando y
 *   gesto expresivo de vuelo/inercia al arrastrar con ratón o dedo.
 */
export function FlameBot3D({
  size = 64,
  mood = 'idle',
  lookX = 0,
  lookY = 0,
  tiltDeg = 0,
  showFloorShadow = true,
  className = '',
}: FlameBot3DProps) {
  const uid = useId().replace(/:/g, '')
  const outerGradId = `fb-outer-${uid}`
  const innerGradId = `fb-inner-${uid}`
  const coreLightId = `fb-core-${uid}`
  const glossGradId = `fb-gloss-${uid}`
  const rimGradId = `fb-rim-${uid}`
  const sparkGradId = `fb-spark-${uid}`

  const clampedX = Math.max(-1, Math.min(1, lookX)) * 2.2
  const clampedY = Math.max(-1, Math.min(1, lookY)) * 1.6
  const clampedTilt = Math.max(-20, Math.min(20, tiltDeg))

  return (
    <span
      className={`fb3d-stage mood-${mood} ${className}`.trim()}
      style={
        {
          width: `${size}px`,
          height: `${size}px`,
          '--fb-tilt': `${clampedTilt}deg`,
        } as React.CSSProperties
      }
      aria-hidden="true"
    >
      {/* Halo cálido posterior (z-index: 0, nunca oscurece el rostro) */}
      <span className="fb3d-aura" />

      <svg
        className="fb3d-svg"
        width={size}
        height={size}
        viewBox="0 0 100 106"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Gradiente principal con profundidad esférica 3D */}
          <radialGradient id={outerGradId} cx="40%" cy="30%" r="72%" fx="36%" fy="24%">
            <stop offset="0%" stopColor="#fff7bd" />
            <stop offset="28%" stopColor="#ffc745" />
            <stop offset="68%" stopColor="#ff741c" />
            <stop offset="94%" stopColor="#db3a0c" />
            <stop offset="100%" stopColor="#b92708" />
          </radialGradient>

          {/* Núcleo interno translúcido incandescente */}
          <radialGradient id={innerGradId} cx="50%" cy="64%" r="54%">
            <stop offset="0%" stopColor="#fffde6" stopOpacity="0.98" />
            <stop offset="52%" stopColor="#ffe175" stopOpacity="0.82" />
            <stop offset="100%" stopColor="#ff9a24" stopOpacity="0" />
          </radialGradient>

          {/* Luz inferior de rebote (subsurface scattering cálido) */}
          <radialGradient id={coreLightId} cx="50%" cy="84%" r="36%">
            <stop offset="0%" stopColor="#ffd966" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#ff6a00" stopOpacity="0" />
          </radialGradient>

          {/* Reflejo especular 3D cristalino */}
          <linearGradient id={glossGradId} x1="24%" y1="12%" x2="66%" y2="58%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.88" />
            <stop offset="55%" stopColor="#fff7d6" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>

          {/* Contorno luminoso (rim light) */}
          <linearGradient id={rimGradId} x1="50%" y1="8%" x2="50%" y2="92%">
            <stop offset="0%" stopColor="#fffbe0" stopOpacity="0.95" />
            <stop offset="55%" stopColor="#ffb347" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#a31f06" stopOpacity="0.62" />
          </linearGradient>

          <radialGradient id={sparkGradId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="45%" stopColor="#fff2a6" />
            <stop offset="100%" stopColor="#ffae2b" />
          </radialGradient>
        </defs>

        {/* Chispas 3D flotantes (más intensas en hover y arrastre) */}
        <g className="fb3d-spark fb3d-spark-1">
          <path
            d="M79 23 Q80.6 18 84.5 18 Q80.6 18 79 13 Q77.4 18 73.5 18 Q77.4 18 79 23Z"
            fill={`url(#${sparkGradId})`}
          />
        </g>
        <g className="fb3d-spark fb3d-spark-2">
          <circle cx="84" cy="40" r="2.3" fill="#ffe48c" />
        </g>
        <g className="fb3d-spark fb3d-spark-3">
          <circle cx="19" cy="34" r="2" fill="#ffd570" />
        </g>
        <g className="fb3d-spark fb3d-spark-4">
          <circle cx="24" cy="19" r="1.4" fill="#fff1b0" />
        </g>

        {/* Silueta orgánica 3D con respiración y vaivén sutil */}
        <g className="fb3d-body-group">
          <path
            className="fb3d-flame-shell"
            d="M50 90 C31.5 90 20 74.5 23.5 56 C26 42.5 34.5 34.5 44.5 24.5 C49.2 19.8 54.4 12.2 60 9.6 C62.1 8.8 64 10.8 62.6 14.2 C58.6 24.2 63 31.5 70.6 42.8 C79.8 56.5 78.2 73.5 70 82.8 C64.2 89.2 57.2 90 50 90 Z"
            fill={`url(#${outerGradId})`}
            stroke={`url(#${rimGradId})`}
            strokeWidth="1.7"
          />

          {/* Núcleo interno incandescente */}
          <path
            className="fb3d-core"
            d="M50 84.5 C38 84.5 30.5 73 32.8 59.5 C34.5 50 40.5 43.2 47 36.5 C50.2 33.2 53.8 28.4 56.8 25.8 C55.2 32.6 58.2 37.2 63.4 45 C69 54.8 69 67.5 63.4 76.2 C59.2 82.2 54.6 84.5 50 84.5 Z"
            fill={`url(#${innerGradId})`}
          />

          {/* Rebote cálido en la base 3D */}
          <ellipse cx="50" cy="81" rx="18" ry="6.5" fill={`url(#${coreLightId})`} />

          {/* Reflejo especular curvo en el borde izquierdo */}
          <path
            d="M35.5 46 C30.5 53.2 29 62.5 31.6 70.8 C33.2 61.5 36.4 53.8 42.6 47 C45.8 43.6 49 39.6 51 35.8 C44.8 38.6 39.4 41.8 35.5 46 Z"
            fill={`url(#${glossGradId})`}
            opacity="0.78"
          />
          <ellipse cx="44" cy="34.5" rx="2.4" ry="1.1" transform="rotate(-38 44 34.5)" fill="#ffffff" opacity="0.7" />

          {/* Rostro 3D expresivo */}
          <g transform={`translate(${clampedX.toFixed(2)} ${clampedY.toFixed(2)})`}>
            {/* Mejillas suaves */}
            <ellipse cx="35" cy="64" rx="4.5" ry="2.4" fill="#ff4726" opacity="0.36" />
            <ellipse cx="65" cy="64" rx="4.5" ry="2.4" fill="#ff4726" opacity="0.36" />

            {/* Ojos con doble destello y parpadeo natural */}
            <g className="fb3d-eyes">
              <ellipse cx="40.2" cy="56.5" rx="4.4" ry={mood === 'dragging' ? 5.8 : 5.2} fill="#141e33" />
              <circle cx="38.8" cy="54.4" r="1.9" fill="#ffffff" />
              <circle cx="42.1" cy="58.3" r="0.9" fill="#ffffff" opacity="0.92" />

              <ellipse cx="59.8" cy="56.5" rx="4.4" ry={mood === 'dragging' ? 5.8 : 5.2} fill="#141e33" />
              <circle cx="58.4" cy="54.4" r="1.9" fill="#ffffff" />
              <circle cx="61.7" cy="58.3" r="0.9" fill="#ffffff" opacity="0.92" />
            </g>

            {/* Boca dinámica según estado */}
            {mood === 'dragging' ? (
              <ellipse cx="50" cy="65.8" rx="3" ry="3.4" fill="#141e33" />
            ) : mood === 'hover' || mood === 'happy' ? (
              <path
                d="M44.2 63.4 Q50 69.4 55.8 63.4"
                stroke="#141e33"
                strokeWidth="2.2"
                strokeLinecap="round"
                fill="none"
              />
            ) : mood === 'thinking' ? (
              <path
                d="M46.2 65.2 Q50 63.5 53.8 65.2"
                stroke="#141e33"
                strokeWidth="2"
                strokeLinecap="round"
                fill="none"
              />
            ) : (
              <path
                d="M45.2 64.2 Q50 68.5 54.8 64.2"
                stroke="#141e33"
                strokeWidth="2"
                strokeLinecap="round"
                fill="none"
              />
            )}
          </g>
        </g>
      </svg>

      {/* Sombra cálida de levitación debajo */}
      {showFloorShadow && <span className="fb3d-floor-shadow" />}
    </span>
  )
}
