import { useMemo, useRef } from "react";

import { Float } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  MeshBasicMaterial,
} from "three";

// ── Spectrum beams ──────────────────────────────────

const SPECTRUM = [
  { color: "#ef4444", angle: -20 },
  { color: "#f97316", angle: -12 },
  { color: "#eab308", angle: -4 },
  { color: "#22c55e", angle: 4 },
  { color: "#3b82f6", angle: 12 },
  { color: "#8b5cf6", angle: 20 },
] as const;

// ── Glowing wireframe prism (matches logo shape) ────
//
// Logo shape: apex top-left, base at bottom
//   A (top-left apex)
//   |\
//   | \
//   B--C  (bottom edge, C is right)
//
// Extruded along Z for 3D depth.

function Diamond() {
  const groupRef = useRef<THREE.Group>(null);

  const baseGeo = useMemo(() => {
    // Front face triangle (matching logo proportions — apex offset left)
    const ax = -0.5,
      ay = 1.2; // top-left apex
    const bx = -1.0,
      by = -0.8; // bottom-left
    const cx = 0.8,
      by2 = -0.8; // bottom-right (wider base)
    const depth = 1.6; // Z-axis depth
    const hd = depth / 2;

    // 6 vertices: front triangle + back triangle
    const v = [
      ax,
      ay,
      -hd, // 0: A front
      bx,
      by,
      -hd, // 1: B front
      cx,
      by2,
      -hd, // 2: C front
      ax,
      ay,
      hd, // 3: A back
      bx,
      by,
      hd, // 4: B back
      cx,
      by2,
      hd, // 5: C back
    ];

    // 8 triangular faces (2 per rectangular side + 2 triangle caps)
    const idx = [
      // Front face
      0, 1, 2,
      // Back face
      3, 5, 4,
      // Bottom (B-C edge)
      1, 4, 5, 1, 5, 2,
      // Left (A-B edge)
      0, 3, 4, 0, 4, 1,
      // Right/hypotenuse (A-C edge)
      0, 2, 5, 0, 5, 3,
    ];

    const positions: number[] = [];
    for (const i of idx) {
      positions.push(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]);
    }

    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(positions, 3));
    g.computeVertexNormals();
    return g;
  }, []);

  // Wireframe edges
  const edgesGeo = useMemo(() => new EdgesGeometry(baseGeo, 1), [baseGeo]);

  // Materials
  const wireMat = useMemo(
    () =>
      new LineBasicMaterial({
        color: new Color("#7c9aff"),
        transparent: true,
        opacity: 0.7,
        linewidth: 1,
      }),
    [],
  );

  // Inner glow fill (semi-transparent, additive)
  const fillMat = useMemo(
    () =>
      new MeshBasicMaterial({
        color: new Color("#4060c0"),
        transparent: true,
        opacity: 0.06,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    [],
  );

  // Slow Y-axis rotation
  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.25;
    }
  });

  return (
    <Float speed={1.5} rotationIntensity={0.08} floatIntensity={0.25}>
      <group ref={groupRef} scale={[0.85, 0.85, 0.85]}>
        {/* Solid fill — very faint */}
        <mesh geometry={baseGeo} material={fillMat} />

        {/* Bright wireframe edges */}
        <primitive object={new LineSegments(edgesGeo, wireMat)} />

        {/* Outer glow wireframe (larger, blurred via thicker line + lower opacity) */}
        <primitive
          object={
            new LineSegments(
              edgesGeo,
              new LineBasicMaterial({
                color: new Color("#6080ff"),
                transparent: true,
                opacity: 0.15,
                linewidth: 1,
              }),
            )
          }
          scale={[1.02, 1.02, 1.02]}
        />

        {/* Inner energy core */}
        <InnerCore />
      </group>
    </Float>
  );
}

// ── Inner energy glow (pulsing sphere inside diamond) ─

function InnerCore() {
  const ref = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (ref.current) {
      const s = 0.2 + Math.sin(clock.elapsedTime * 1.5) * 0.05;
      ref.current.scale.set(s, s, s);
    }
  });

  return (
    <mesh ref={ref}>
      <sphereGeometry args={[1, 16, 16]} />
      <meshBasicMaterial
        color="#8090ff"
        transparent
        opacity={0.12}
        blending={AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  );
}

// ── Beam (tapered cylinder along X-axis) ────────────

// ── Tapered ray (flat plane, always faces camera) ───

function Ray({
  start,
  angle,
  color,
  length,
  startWidth,
  endWidth,
  opacity,
}: {
  start: [number, number, number];
  angle: number;
  color: string;
  length: number;
  startWidth: number;
  endWidth: number;
  opacity: number;
}) {
  // Build a tapered quad from 4 vertices
  const geo = useMemo(() => {
    const hw0 = startWidth / 2;
    const hw1 = endWidth / 2;
    const verts = new Float32Array([
      0,
      -hw0,
      0, // bottom-left (start)
      0,
      hw0,
      0, // top-left (start)
      length,
      hw1,
      0, // top-right (end)
      length,
      -hw1,
      0, // bottom-right (end)
    ]);
    const triVerts = new Float32Array([
      0,
      -hw0,
      0,
      0,
      hw0,
      0,
      length,
      hw1,
      0,
      0,
      -hw0,
      0,
      length,
      hw1,
      0,
      length,
      -hw1,
      0,
    ]);
    const g2 = new BufferGeometry();
    g2.setAttribute("position", new Float32BufferAttribute(triVerts, 3));
    return g2;
  }, [length, startWidth, endWidth]);

  const mat = useMemo(
    () =>
      new MeshBasicMaterial({
        color: new Color(color),
        transparent: true,
        opacity,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      }),
    [color, opacity],
  );

  const rad = (angle * Math.PI) / 180;

  return <mesh geometry={geo} material={mat} position={start} rotation={[0, 0, rad]} />;
}

// ── Incoming beam (simple glowing line, not a mesh) ─

function IncomingBeam() {
  const points = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute([-4.5, 0, 0, 0, 0, 0], 3));
    return g;
  }, []);

  return (
    <group>
      {/* Core line */}
      <primitive
        object={
          new LineSegments(
            points,
            new LineBasicMaterial({
              color: new Color("#a0b0ee"),
              transparent: true,
              opacity: 0.6,
            }),
          )
        }
      />
      {/* Glow halo — slightly wider, fainter */}
      <mesh position={[-2.25, 0, 0]}>
        <planeGeometry args={[4.5, 0.06]} />
        <meshBasicMaterial
          color="#7888cc"
          transparent
          opacity={0.15}
          blending={AdditiveBlending}
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>
    </group>
  );
}

// ── Flowing particle along a spectrum ray ────────────

function RayParticle({
  angle,
  color,
  length,
  delay,
}: {
  angle: number;
  color: string;
  length: number;
  delay: number;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const rad = (angle * Math.PI) / 180;
  const speed = 1.8; // seconds for one trip
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    // Progress 0→1, looping
    const t = ((clock.elapsedTime + delay) % speed) / speed;
    const d = t * length;
    ref.current.position.x = d * cos;
    ref.current.position.y = d * sin;
    // Fade in at start, fade out at end
    const opacity = t < 0.1 ? t / 0.1 : t > 0.85 ? (1 - t) / 0.15 : 1;
    (ref.current.material as MeshBasicMaterial).opacity = opacity * 0.7;
    // Shrink as it travels
    const s = 0.025 * (1 - t * 0.5);
    ref.current.scale.set(s, s, s);
  });

  return (
    <mesh ref={ref}>
      <sphereGeometry args={[1, 8, 8]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.7}
        blending={AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  );
}

// ── All beams — originating FROM the prism center ───

function SpectrumBeams() {
  return (
    <group>
      {/* Incoming light — thin glowing line */}
      <IncomingBeam />

      {/* Dispersed spectrum — from prism center, fanning out */}
      {SPECTRUM.map((s, i) => (
        <group key={i}>
          <Ray
            start={[0, 0, 0]}
            angle={s.angle}
            color={s.color}
            length={4.5}
            startWidth={0.04}
            endWidth={0.008}
            opacity={0.4}
          />
          {/* Flowing particle along the ray */}
          <RayParticle angle={s.angle} color={s.color} length={4.5} delay={i * 0.4} />
        </group>
      ))}
    </group>
  );
}

// ── Floating particles (ambient tech feel) ──────────

function Particles() {
  const ref = useRef<THREE.Points>(null);

  const { positions, colors } = useMemo(() => {
    const count = 60;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const palette = [new Color("#6080ff"), new Color("#80a0ff"), new Color("#a0b8ff")];

    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 8;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 5;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 4;
      const c = palette[Math.floor(Math.random() * palette.length)];
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    return { positions: pos, colors: col };
  }, []);

  useFrame((_, delta) => {
    if (ref.current) {
      ref.current.rotation.y += delta * 0.02;
    }
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.03}
        vertexColors
        transparent
        opacity={0.4}
        blending={AdditiveBlending}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  );
}

// ── Default export (lazy-loaded) ────────────────────

export default function PrismScene() {
  return (
    <Canvas
      camera={{ position: [0, 0.3, 5], fov: 40 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      style={{ width: "100%", height: "100%", background: "transparent" }}
    >
      <ambientLight intensity={0.3} />
      <directionalLight position={[3, 5, 4]} intensity={0.6} />

      <Diamond />
      <SpectrumBeams />
      <Particles />
    </Canvas>
  );
}
