/// <reference lib="dom" />

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';


// --- TYPES ---
interface Point {
  x: number;
  y: number;
}

interface ProjectileState {
  position: Point;
  velocity: Point;
}

interface SimulationDataPoint {
    time: number;
    posX: number;
    posY: number;
    vel: number;
    acc: number;
}

// --- CONSTANTS ---
const GRAVITY = 9.81; // m/s^2
const AIR_DENSITY = 1.225; // kg/m^3
const SCALE = 20; // pixels per meter
const CANNON_BASE_HEIGHT = 20; // pixels
const CANNON_LENGTH = 60; // pixels
const CANNON_PIVOT_X = 30; // pixels from the back of the cannon base
const FIXED_DT = 1 / 120; // Physics updates per second for a stable simulation

// --- HELPER ICONS ---
const PlayIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3l14 9-14 9V3z" />
  </svg>
);

const ResetIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h5M20 20v-5h-5M4 4l16 16" />
  </svg>
);

const EraseIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
);


// --- REUSABLE UI COMPONENTS ---

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}
const Slider: React.FC<SliderProps> = ({ label, value, min, max, step, unit, onChange }) => (
  <div className="flex flex-col space-y-1">
    <div className="flex justify-between text-sm text-gray-700">
      <span>{label}</span>
      <span className="font-semibold">{value.toFixed(2)} {unit}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={onChange}
      className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
    />
  </div>
);

interface CheckboxProps {
  label: string;
  checked: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}
const Checkbox: React.FC<CheckboxProps> = ({ label, checked, onChange }) => (
    <label className="flex items-center space-x-2 cursor-pointer text-gray-700">
        <input type="checkbox" checked={checked} onChange={onChange} className="form-checkbox h-4 w-4 text-blue-600 rounded" />
        <span className="text-sm">{label}</span>
    </label>
);

// --- MAIN APP COMPONENT ---

export default function App() {
  const [initialSpeed, setInitialSpeed] = useState(15);
  const [angle, setAngle] = useState(45);
  const [mass, setMass] = useState(5);
  const [diameter, setDiameter] = useState(0.5);
  const [airResistance, setAirResistance] = useState(false);
  
  const [projectile, setProjectile] = useState<ProjectileState | null>(null);
  const [paths, setPaths] = useState<Point[][]>([]);
  const [currentPath, setCurrentPath] = useState<Point[]>([]);

  const [isRunning, setIsRunning] = useState(false);
  const [simulationTime, setSimulationTime] = useState(0);

  const [showVelocity, setShowVelocity] = useState(true);
  const [showAcceleration, setShowAcceleration] = useState(true);
  const [showForce, setShowForce] = useState(true);
  const [showCharts, setShowCharts] = useState(false);
  const [impactPoint, setImpactPoint] = useState<Point | null>(null);

  const [allSimulationData, setAllSimulationData] = useState<SimulationDataPoint[][]>([]);
  const [selectedPathIndex, setSelectedPathIndex] = useState(0);
  const currentSimDataRef = useRef<SimulationDataPoint[]>([]);

  const animationFrameId = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const accumulatorRef = useRef(0);
  const simContainerRef = useRef<HTMLDivElement>(null);

  const dragCoefficient = 0.47; // For a sphere

    const playCannonSound = () => {
        try {
            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            if (!audioContext) return;
            
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.type = 'sine';
            gainNode.gain.setValueAtTime(0.5, audioContext.currentTime);
            
            oscillator.frequency.setValueAtTime(120, audioContext.currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.5);
            gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.5);

            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.5);
        } catch (error) {
            console.error("Could not play sound:", error);
        }
    };


  const fireCannon = () => {
    if (isRunning) return;

    playCannonSound();

    const angleRad = (angle * Math.PI) / 180;
    const initialVelocity = {
      x: initialSpeed * Math.cos(angleRad),
      y: initialSpeed * Math.sin(angleRad),
    };
    
    const cannonEndX = CANNON_PIVOT_X + CANNON_LENGTH * Math.cos(angleRad);
    const cannonEndY = CANNON_BASE_HEIGHT + CANNON_LENGTH * Math.sin(angleRad);
    
    const startPos = { x: cannonEndX / SCALE, y: cannonEndY / SCALE };

    setProjectile({
      position: startPos,
      velocity: initialVelocity,
    });

    if (currentPath.length > 0) {
        setPaths(prev => [...prev, currentPath]);
    }
    setCurrentPath([startPos]);
    currentSimDataRef.current = [{
        time: 0,
        posX: startPos.x,
        posY: startPos.y,
        vel: initialSpeed,
        acc: GRAVITY 
    }];
    setSimulationTime(0);
    setIsRunning(true);
    lastTimeRef.current = performance.now();
    accumulatorRef.current = 0;
  };

  const resetSimulation = () => {
    setIsRunning(false);
    setProjectile(null);
    setCurrentPath([]);
    setPaths([]);
    setAllSimulationData([]);
    setSelectedPathIndex(0);
    setShowCharts(false);
    setImpactPoint(null);
    if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
    }
  };

  const erasePaths = () => {
      setCurrentPath([]);
      setPaths([]);
      setAllSimulationData([]);
      setSelectedPathIndex(0);
      setShowCharts(false);
      setImpactPoint(null);
  }

  const runSimulation = useCallback((timestamp: number) => {
    if (!lastTimeRef.current || !projectile) {
      lastTimeRef.current = timestamp;
      animationFrameId.current = requestAnimationFrame(runSimulation);
      return;
    }

    let frameTime = (timestamp - lastTimeRef.current) / 1000;
    lastTimeRef.current = timestamp;

    // Prevents "spiral of death" if tab is backgrounded
    if (frameTime > 0.25) {
      frameTime = 0.25;
    }

    accumulatorRef.current += frameTime;

    let tempProjectile = { ...projectile };
    let tempSimTime = simulationTime;
    const newPathPoints = [];
    const newSimDataPoints = [];

    // Run physics updates in fixed steps
    while (accumulatorRef.current >= FIXED_DT) {
      const { position, velocity } = tempProjectile;

      // Stop physics updates if it's already on the ground
      if (position.y <= 0 && tempSimTime > 0.1) {
          accumulatorRef.current = 0;
          break;
      }

      let ax = 0;
      let ay = -GRAVITY;

      if (airResistance) {
        const area = Math.PI * Math.pow(diameter / 2, 2);
        const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2);
        if (speed > 0) {
          const dragForceMagnitude = 0.5 * AIR_DENSITY * speed ** 2 * dragCoefficient * area;
          const Fdx = -dragForceMagnitude * (velocity.x / speed);
          const Fdy = -dragForceMagnitude * (velocity.y / speed);
          ax += Fdx / mass;
          ay += Fdy / mass;
        }
      }
      
      const newVelocity = {
        x: velocity.x + ax * FIXED_DT,
        y: velocity.y + ay * FIXED_DT,
      };

      const newPosition = {
        x: position.x + velocity.x * FIXED_DT,
        y: position.y + velocity.y * FIXED_DT,
      };
      
      tempProjectile = { position: newPosition, velocity: newVelocity };
      tempSimTime += FIXED_DT;

      newPathPoints.push(newPosition);
      const speed = Math.sqrt(newVelocity.x ** 2 + newVelocity.y ** 2);
      const accMag = Math.sqrt(ax ** 2 + ay ** 2);
      newSimDataPoints.push({
          time: tempSimTime,
          posX: newPosition.x,
          posY: newPosition.y,
          vel: speed,
          acc: accMag
      });

      accumulatorRef.current -= FIXED_DT;
    }
    
    // Update state once per frame with all the new points
    if (newPathPoints.length > 0) {
      setProjectile(tempProjectile);
      setCurrentPath(prev => [...prev, ...newPathPoints]);
      setSimulationTime(tempSimTime);
      currentSimDataRef.current.push(...newSimDataPoints);
    }

    // Check for ground collision after physics updates
    if (tempProjectile.position.y <= 0 && simulationTime > 0) {
      setIsRunning(false);
      
      const finalPosition = { ...tempProjectile.position, y: 0 };
      const finalPath = [...currentPath, ...newPathPoints.slice(0, -1), finalPosition];
      const finalSimData = [...currentSimDataRef.current];

      currentSimDataRef.current = [];

      setProjectile(p => p ? { ...p, position: finalPosition } : null);
      setCurrentPath(finalPath);
      setImpactPoint(finalPosition);

      setTimeout(() => {
        setPaths(prev => [...prev, finalPath]);
        setAllSimulationData(prev => [...prev, finalSimData]);
        setShowCharts(true);
        
        setCurrentPath([]);
        setProjectile(null);
        setImpactPoint(null);
      }, 500);
      return;
    }

    animationFrameId.current = requestAnimationFrame(runSimulation);
  }, [projectile, mass, diameter, airResistance, dragCoefficient, simulationTime, currentPath]);

  useEffect(() => {
    if (isRunning) {
      animationFrameId.current = requestAnimationFrame(runSimulation);
    }
    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning, runSimulation]);

  useEffect(() => {
    if (allSimulationData.length > 0) {
      setSelectedPathIndex(allSimulationData.length - 1);
    }
  }, [allSimulationData]);

  const containerHeight = simContainerRef.current?.clientHeight || 600;
  const groundY = containerHeight - 50;

  const getAccelerationVector = (): Point => {
      if(!projectile) return {x: 0, y: 0};
      
      let ax = 0;
      let ay = -GRAVITY;

      if (airResistance) {
          const { velocity } = projectile;
          const area = Math.PI * Math.pow(diameter / 2, 2);
          const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2);
          if (speed > 0) {
              const dragForceMagnitude = 0.5 * AIR_DENSITY * speed ** 2 * dragCoefficient * area;
              const Fdx = -dragForceMagnitude * (velocity.x / speed);
              const Fdy = -dragForceMagnitude * (velocity.y / speed);
              ax += Fdx / mass;
              ay += Fdy / mass;
          }
      }
      return {x: ax, y: ay};
  }

  const getForceVector = (): Point => {
      if (!projectile) return { x: 0, y: 0 };
      const acc = getAccelerationVector();
      return {
          x: acc.x * mass,
          y: acc.y * mass
      };
  }

  const renderVector = (pos: Point, vel: Point, color: string, scaleFactor: number, label: string) => {
    const startX = pos.x * SCALE;
    const startY = groundY - pos.y * SCALE;
    const endX = startX + vel.x * scaleFactor;
    const endY = startY - vel.y * scaleFactor;

    const angle = Math.atan2(endY - startY, endX - startX);
    const arrowSize = 8;
    
    const arrowP1X = endX - arrowSize * Math.cos(angle - Math.PI / 6);
    const arrowP1Y = endY - arrowSize * Math.sin(angle - Math.PI / 6);
    const arrowP2X = endX - arrowSize * Math.cos(angle + Math.PI / 6);
    const arrowP2Y = endY - arrowSize * Math.sin(angle + Math.PI / 6);

    return (
      <g stroke={color} fill={color}>
        <line x1={startX} y1={startY} x2={endX} y2={endY} strokeWidth="2" />
        <polygon points={`${endX},${endY} ${arrowP1X},${arrowP1Y} ${arrowP2X},${arrowP2Y}`} />
        <text x={endX + 5} y={endY} fontSize="12" fill={color}>{label}</text>
      </g>
    );
  }

  return (
    <div className="w-screen h-screen bg-sky-200 flex flex-col overflow-hidden font-sans">
      <div className="absolute top-4 left-4 text-xl font-bold text-gray-700">Movimento de Projétil</div>

      {/* --- SIMULATION AREA --- */}
      <div ref={simContainerRef} className="flex-grow w-full relative">
        <svg width="100%" height="100%">
          {/* Ground */}
          <rect x="0" y={groundY} width="100%" height="50" fill="#4ade80" />
          <rect x="0" y={groundY} width="100%" height="5" fill="#22c55e" />

          {/* Cannon */}
          <g transform={`translate(${CANNON_PIVOT_X}, ${groundY - CANNON_BASE_HEIGHT})`}>
              <g transform={`rotate(${-angle})`}>
                  <rect x="0" y="-10" width={CANNON_LENGTH} height="20" fill="#475569" />
                  <rect x={CANNON_LENGTH - 10} y="-15" width="10" height="30" fill="#64748b" rx="2" />
              </g>
              <circle cx="0" cy="0" r="20" fill="#334155" />
              <circle cx="-25" cy="15" r="15" fill="#334155" />
              <circle cx="25" cy="15" r="15" fill="#334155" />
          </g>

          {/* Paths */}
          {paths.map((path, index) => (
            <polyline
              key={index}
              points={path.map(p => `${p.x * SCALE},${groundY - p.y * SCALE}`).join(' ')}
              fill="none"
              stroke="rgba(0,0,255,0.5)"
              strokeWidth="2"
            />
          ))}

          {/* Current Path */}
          <polyline
            points={currentPath.map(p => `${p.x * SCALE},${groundY - p.y * SCALE}`).join(' ')}
            fill="none"
            stroke="blue"
            strokeWidth="3"
            strokeDasharray={isRunning ? "5 5" : "none"}
          />

          {/* Projectile */}
          {projectile && (
            <g transform={`translate(${projectile.position.x * SCALE}, ${groundY - projectile.position.y * SCALE})`}>
              <circle cx="0" cy="0" r={diameter * SCALE / 2} fill="black" />
              {showVelocity && renderVector({x:0, y:0}, projectile.velocity, '#22c55e', 3, 'v')}
              {showAcceleration && renderVector({x:0, y:0}, getAccelerationVector(), '#facc15', 3, 'a')}
              {showForce && renderVector({x:0, y:0}, getForceVector(), '#f97316', 1, 'F')}
            </g>
          )}

          {/* Impact Animation */}
          {impactPoint && (
              <g transform={`translate(${impactPoint.x * SCALE}, ${groundY})`}>
                  <circle cx="0" cy="0" r="0" fill="none" stroke="#4b5563" strokeWidth="2">
                      <animate attributeName="r" from="0" to="20" dur="0.5s" begin="0s" fill="freeze" />
                      <animate attributeName="opacity" from="0.8" to="0" dur="0.5s" begin="0s" fill="freeze" />
                  </circle>
              </g>
          )}

          {/* Target and Measurement */}
           {currentPath.length > 0 && currentPath[currentPath.length-1].y <=0 && !isRunning &&
            (() => {
                const finalPos = currentPath[currentPath.length-1];
                const cannonOriginX = CANNON_PIVOT_X / SCALE;
                const distance = finalPos.x - cannonOriginX;
                return (
                    <g transform={`translate(${finalPos.x * SCALE}, ${groundY})`}>
                        <rect x="-30" y="-10" width="60" height="20" rx="10" fill="red" />
                        <rect x="-25" y="-5" width="50" height="10" rx="5" fill="white" />
                        <circle cx="0" cy="0" r="5" fill="red" />
                        <text x="0" y="30" textAnchor="middle" fill="#4b5563" fontWeight="bold">{distance.toFixed(2)} m</text>
                    </g>
                )
            })()
           }

        </svg>
      </div>
      
      {/* --- CHARTS SECTION --- */}
      {showCharts && allSimulationData.length > 0 && allSimulationData[selectedPathIndex] && (
        <div className="w-full bg-white p-4 shadow-inner space-y-4 h-80 flex flex-col shrink-0">
            <div className="flex items-center space-x-4">
                <h3 className="text-lg font-bold text-gray-800">Análise da Trajetória</h3>
                <select 
                    value={selectedPathIndex} 
                    onChange={e => setSelectedPathIndex(parseInt(e.target.value))}
                    className="p-2 rounded border border-gray-300 bg-gray-50 text-sm"
                    aria-label="Selecione uma trajetória para analisar"
                >
                    {allSimulationData.map((_, index) => (
                        <option key={index} value={index}>
                            Trajetória {index + 1}
                        </option>
                    ))}
                </select>
            </div>
            <div className="flex-grow flex space-x-2 text-xs">
                <div className="w-1/3 h-full">
                    <ResponsiveContainer>
                        <LineChart data={allSimulationData[selectedPathIndex]} margin={{ top: 35, right: 20, left: -10, bottom: 20 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="time" label={{ value: 'Tempo (s)', position: 'insideBottom', offset: -10 }} />
                            <YAxis label={{ value: 'Posição (m)', angle: -90, position: 'insideLeft' }} />
                            <Tooltip formatter={(value: number) => value.toFixed(2)} />
                            <Legend verticalAlign="top" height={30} />
                            <Line type="monotone" dataKey="posX" name="Posição X" stroke="#8884d8" dot={false} />
                            <Line type="monotone" dataKey="posY" name="Posição Y" stroke="#82ca9d" dot={false} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
                <div className="w-1/3 h-full">
                    <ResponsiveContainer>
                        <LineChart data={allSimulationData[selectedPathIndex]} margin={{ top: 35, right: 20, left: -10, bottom: 20 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="time" label={{ value: 'Tempo (s)', position: 'insideBottom', offset: -10 }} />
                            <YAxis label={{ value: 'Velocidade (m/s)', angle: -90, position: 'insideLeft' }} />
                            <Tooltip formatter={(value: number) => value.toFixed(2)} />
                            <Legend verticalAlign="top" height={30} />
                            <Line type="monotone" dataKey="vel" name="Velocidade" stroke="#ffc658" dot={false} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
                <div className="w-1/3 h-full">
                    <ResponsiveContainer>
                        <LineChart data={allSimulationData[selectedPathIndex]} margin={{ top: 35, right: 20, left: -10, bottom: 20 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="time" label={{ value: 'Tempo (s)', position: 'insideBottom', offset: -10 }} />
                            <YAxis label={{ value: 'Aceleração (m/s²)', angle: -90, position: 'insideLeft' }} />
                            <Tooltip formatter={(value: number) => value.toFixed(2)} />
                            <Legend verticalAlign="top" height={30} />
                            <Line type="monotone" dataKey="acc" name="Aceleração" stroke="#ff7300" dot={false} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
      )}

      {/* --- TOP RIGHT CONTROLS --- */}
      <div className="absolute top-4 right-4 bg-white/70 backdrop-blur-sm p-4 rounded-lg shadow-lg w-72 space-y-4">
        <h3 className="font-bold text-center text-gray-800">Parâmetros</h3>
        <Slider label="Massa" value={mass} min={1} max={20} step={0.1} unit="kg" onChange={e => setMass(parseFloat(e.currentTarget.value))} />
        <Slider label="Diâmetro" value={diameter} min={0.1} max={1} step={0.01} unit="m" onChange={e => setDiameter(parseFloat(e.currentTarget.value))} />
        <div className="pt-2">
            <label className="flex items-center space-x-2 cursor-pointer text-gray-700">
                <input type="checkbox" checked={airResistance} onChange={e => setAirResistance(e.currentTarget.checked)} className="form-checkbox h-4 w-4 text-blue-600 rounded"/>
                <span className="text-sm font-medium">Resistência do Ar</span>
            </label>
            {airResistance && <div className="text-xs text-gray-500 pl-6">Coeficiente de Arrasto: {dragCoefficient}</div>}
        </div>
        <hr/>
        <div className="space-y-2">
            <Checkbox label="Vetores de Velocidade" checked={showVelocity} onChange={e => setShowVelocity(e.currentTarget.checked)} />
            <Checkbox label="Vetores de Aceleração" checked={showAcceleration} onChange={e => setShowAcceleration(e.currentTarget.checked)} />
            <Checkbox label="Vetores de Força" checked={showForce} onChange={e => setShowForce(e.currentTarget.checked)} />
        </div>
      </div>


      {/* --- BOTTOM CONTROLS --- */}
      <div className="w-full bg-gray-700/80 backdrop-blur-sm p-2 flex items-center justify-center space-x-6">
        <div className="flex flex-col items-center">
             <label className="text-white text-xs">Ângulo</label>
             <input type="number" value={angle} onChange={e => setAngle(parseInt(e.currentTarget.value, 10))} className="w-20 bg-gray-600 text-white text-center rounded-md p-1"/>
        </div>

        <div className="flex flex-col items-center w-64">
             <label className="text-white text-xs">Velocidade Inicial: {initialSpeed.toFixed(1)} m/s</label>
            <input type="range" min="1" max="30" step="0.5" value={initialSpeed} onChange={e => setInitialSpeed(parseFloat(e.currentTarget.value))} className="w-full"/>
        </div>

        <button onClick={erasePaths} title="Apagar Trajetórias" className="p-3 bg-yellow-400 text-gray-800 rounded-full hover:bg-yellow-300 transition-colors shadow-lg">
            <EraseIcon />
        </button>

        <button onClick={fireCannon} title="Disparar" className="p-5 bg-red-600 text-white rounded-full hover:bg-red-500 transition-colors shadow-lg disabled:bg-gray-400" disabled={isRunning}>
            <PlayIcon />
        </button>

        <button onClick={resetSimulation} title="Reiniciar Simulação" className="p-3 bg-blue-500 text-white rounded-full hover:bg-blue-400 transition-colors shadow-lg">
            <ResetIcon />
        </button>
      </div>
    </div>
  );
}
