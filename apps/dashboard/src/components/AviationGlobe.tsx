import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import MissionGlobe, { COMMS, REGIONS, SERVICE_HUBS, healthColor, outlines, type AirspaceProps } from "./MissionGlobe";
import { routePoint } from "../geometry";
export type { AirspaceProps, RegionId } from "./MissionGlobe";

function coordinate(lat: number, lon: number, radius = 1): THREE.Vector3 {
  const phi = (lat * Math.PI) / 180;
  const lambda = (lon * Math.PI) / 180;
  return new THREE.Vector3(
    radius * Math.cos(phi) * Math.cos(lambda),
    radius * Math.sin(phi),
    -radius * Math.cos(phi) * Math.sin(lambda),
  );
}

function releaseGroup(group: THREE.Group): void {
  for (const child of [...group.children]) {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
      child.geometry.dispose();
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];
      materials.forEach((material) => material.dispose());
    }
    group.remove(child);
  }
}

export default function AviationGlobe(props: AirspaceProps) {
  const container = useRef<HTMLDivElement>(null);
  const current = useRef(props);
  current.current = props;
  const [fallback, setFallback] = useState(false);
  const overlay = useRef<HTMLDivElement>(null);
  const [commsVisible, setCommsVisible] = useState(true);
  const [landmarksVisible, setLandmarksVisible] = useState(true);
  const visibility = useRef({ comms: true, landmarks: true });
  visibility.current = { comms: commsVisible, landmarks: landmarksVisible };
  const controller = useRef<{
    zoom: (amount: number) => void;
    reset: () => void;
  } | null>(null);

  useEffect(() => {
    if (fallback) return;
    const host = container.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "low-power",
      });
    } catch {
      setFallback(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute(
      "aria-label",
      "Interactive 3D aviation globe. Drag to orbit; scroll to zoom. Select aircraft below for keyboard access.",
    );
    renderer.domElement.setAttribute("role", "img");
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(39, 1, 0.002, 40);
    const home = () => {
      const preset = REGIONS[current.current.region ?? "regional"];
      return coordinate(preset.lat, preset.lon, preset.radius);
    };
    camera.position.copy(home());
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.055;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controls.zoomSpeed = 0.65;
    controls.minDistance = 1.04;
    controls.maxDistance = 4.2;
    controls.autoRotate = false;
    controls.rotateSpeed = 0.5;
    controller.current = {
      zoom: (amount) => {
        const step = Math.max(0.04, (camera.position.length() - 1.02) * 0.25);
        const offset = camera.position.clone().sub(controls.target);
        offset.setLength(THREE.MathUtils.clamp(offset.length() + Math.sign(amount) * step, 1.04, 4.2));
        camera.position.copy(controls.target).add(offset);
        controls.update();
      },
      reset: () => {
        camera.position.copy(home());
        controls.target.set(0, 0, 0);
        controls.update();
      },
    };

    const earthMaterial = new THREE.MeshPhongMaterial({
      color: 0x203b50,
      shininess: 8,
      specular: 0x182330,
    });
    const earthGeometry = new THREE.SphereGeometry(1, 80, 56);
    const earth = new THREE.Mesh(earthGeometry, earthMaterial);
    scene.add(earth);
    scene.add(new THREE.AmbientLight(0xadbccc, 1.45));
    const sun = new THREE.DirectionalLight(0xdce9ff, 2);
    sun.position.set(4, 3, 5);
    scene.add(sun);

    const atmosphereGeometry = new THREE.SphereGeometry(1.025, 64, 48);
    const atmosphereMaterial = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.BackSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader:
        "varying vec3 n; varying vec3 v; void main(){vec4 p=modelViewMatrix*vec4(position,1.0);n=normalize(normalMatrix*normal);v=normalize(-p.xyz);gl_Position=projectionMatrix*p;}",
      fragmentShader:
        "varying vec3 n; varying vec3 v; void main(){float rim=pow(1.0-abs(dot(normalize(n),normalize(v))),3.0);gl_FragColor=vec4(0.20,0.43,0.65,rim*0.42);}",
    });
    scene.add(new THREE.Mesh(atmosphereGeometry, atmosphereMaterial));

    let disposed = false;
    const coasts = new THREE.Group();
    outlines.forEach(line => {
      const points: THREE.Vector3[] = [];
      line.slice(1).forEach(([lon, lat], i) => {
        const [aLon, aLat] = line[i];
        const segments = Math.max(2, Math.ceil(Math.hypot(lon - aLon, lat - aLat)));
        for (let j = 0; j <= segments; j++) {
          const [x, y] = routePoint({ lon: aLon, lat: aLat }, { lon, lat }, j / segments);
          points.push(coordinate(y, x, 1.003));
        }
      });
      coasts.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0x78b1c9, transparent: true, opacity: 0.7 })));
    });
    const comms = new THREE.Group();
    COMMS.forEach(({ from, to }) => {
      const geometry = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 97 }, (_, i) => {
        const t = i / 96;
        const [lon, lat] = routePoint(from, to, t);
        return coordinate(lat, lon, 1.008 + Math.sin(t * Math.PI) * 0.025);
      }));
      const arc = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending }));
      arc.userData.target = to.id;
      comms.add(arc);
    });
    const hubs = new THREE.Group();
    SERVICE_HUBS.forEach(hub => {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 10, 8), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
      dot.position.copy(coordinate(hub.lat, hub.lon, 1.006));
      dot.userData.nodeId = hub.id;
      hubs.add(dot);
    });
    scene.add(coasts, comms, hubs);

    const grid = new THREE.Group();
    const gridMaterial = new THREE.LineBasicMaterial({
      color: 0x819aab,
      transparent: true,
      opacity: 0.09,
    });
    for (let latitude = -75; latitude <= 75; latitude += 15) {
      const points = Array.from({ length: 181 }, (_, i) =>
        coordinate(latitude, i * 2 - 180, 1.002),
      );
      grid.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          gridMaterial,
        ),
      );
    }
    for (let longitude = -180; longitude < 180; longitude += 15) {
      const points = Array.from({ length: 91 }, (_, i) =>
        coordinate(i * 2 - 90, longitude, 1.002),
      );
      grid.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          gridMaterial,
        ),
      );
    }
    scene.add(grid);

    const routes = new THREE.Group();
    const aircraft = new THREE.Group();
    const airports = new THREE.Group();
    scene.add(routes, aircraft, airports);
    const planeGeometry = new THREE.ConeGeometry(0.004, 0.014, 3);
    const planeMaterial = new THREE.MeshBasicMaterial({ color: 0xe7eff4 });
    const stoppedMaterial = new THREE.MeshBasicMaterial({ color: 0xf0957e });
    const airportGeometry = new THREE.SphereGeometry(0.003, 6, 6);
    const airportMaterial = new THREE.MeshBasicMaterial({ color: 0x9bc3dd });
    const markers = new Map<string, THREE.Mesh>();
    const selectedRingGeometry = new THREE.RingGeometry(0.022, 0.024, 32);
    const selectedRingMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(selectedRingGeometry, selectedRingMaterial);
    scene.add(ring);
    ring.visible = false;
    let routeSignature = "";
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let down = { x: 0, y: 0 };
    const pointerDown = (event: PointerEvent) => {
      down = { x: event.clientX, y: event.clientY };
    };
    const pointerUp = (event: PointerEvent) => {
      if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5)
        return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects([...aircraft.children, ...(hubs.visible ? hubs.children : []), earth]);
      const hit = hits[0];
      if (hit?.object.userData.flightId)
        current.current.onSelect?.(String(hit.object.userData.flightId));
      if (hit?.object.userData.nodeId)
        current.current.onSelectNode?.(String(hit.object.userData.nodeId));
    };
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointerup", pointerUp);
    const contextLost = (event: Event) => {
      event.preventDefault();
      setFallback(true);
    };
    renderer.domElement.addEventListener("webglcontextlost", contextLost);

    const resize = new ResizeObserver(() => {
      const { width, height } = host.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    });
    resize.observe(host);
    let frame = 0;
    const animate = () => {
      if (disposed) return;
      frame = requestAnimationFrame(animate);
      const { flights, selected } = current.current;
      const signature = flights.flights
        .map((f) => `${f.id}:${f.from.code}:${f.to.code}`)
        .join("|");
      if (signature !== routeSignature) {
        routeSignature = signature;
        releaseGroup(routes);
        for (const child of [...airports.children]) airports.remove(child);
        for (const child of [...aircraft.children]) aircraft.remove(child);
        markers.clear();
        const uniqueAirports = new Set<string>();
        flights.flights.forEach((f) => {
          const points = Array.from({ length: 65 }, (_, i) => {
            const t = i / 64;
            const [lon, lat] = routePoint(f.from, f.to, t);
            return coordinate(lat, lon, 1.005 + Math.sin(t * Math.PI) * 0.045);
          });
          routes.add(
            new THREE.Line(
              new THREE.BufferGeometry().setFromPoints(points),
              new THREE.LineBasicMaterial({
                color: 0xa8c5d7,
                transparent: true,
                opacity: 0.19,
              }),
            ),
          );
          const marker = new THREE.Mesh(planeGeometry, planeMaterial);
          marker.userData.flightId = f.id;
          marker.position.copy(
            coordinate(f.position.lat, f.position.lon, 1.012),
          );
          aircraft.add(marker);
          markers.set(f.id, marker);
          [f.from, f.to].forEach((a) => {
            if (uniqueAirports.has(a.code)) return;
            uniqueAirports.add(a.code);
            const airport = new THREE.Mesh(airportGeometry, airportMaterial);
            airport.position.copy(coordinate(a.lat, a.lon, 1.005));
            airports.add(airport);
          });
        });
      }
      ring.visible = false;
      flights.flights.forEach((f) => {
        const marker = markers.get(f.id);
        if (!marker) return;
        marker.position.lerp(
          coordinate(f.position.lat, f.position.lon, 1.012),
          0.08,
        );
        marker.material =
          flights.groundStop && f.status !== "enroute"
            ? stoppedMaterial
            : planeMaterial;
        const normal = marker.position.clone().normalize();
        const north = new THREE.Vector3(0, 1, 0)
          .addScaledVector(normal, -normal.y)
          .normalize();
        const east = new THREE.Vector3()
          .crossVectors(north, normal)
          .normalize();
        const heading = (f.heading * Math.PI) / 180;
        const forward = north
          .multiplyScalar(Math.cos(heading))
          .addScaledVector(east, Math.sin(heading));
        marker.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          forward.normalize(),
        );
        if (selected === f.id) {
          ring.visible = true;
          ring.position.copy(coordinate(f.position.lat, f.position.lon, 1.02));
          ring.lookAt(ring.position.clone().multiplyScalar(2));
        }
      });
      controls.rotateSpeed = THREE.MathUtils.clamp((camera.position.length() - 1.0) * 0.38, 0.04, 0.45);
      controls.update();
      if (camera.position.length() < 1.04) camera.position.setLength(1.04);
      camera.updateMatrixWorld();
      comms.visible = visibility.current.comms;
      hubs.visible = visibility.current.landmarks;
      hubs.children.forEach(child => {
        if (child instanceof THREE.Mesh) (child.material as THREE.MeshBasicMaterial).color.set(healthColor(current.current.nodes, String(child.userData.nodeId)));
      });
      comms.children.forEach(child => {
        if (child instanceof THREE.Line) (child.material as THREE.LineBasicMaterial).color.set(healthColor(current.current.nodes, String(child.userData.target)));
      });
      const width = host.clientWidth, height = host.clientHeight;
      overlay.current?.querySelectorAll<HTMLElement>("[data-lat]").forEach(el => {
        const flight = el.dataset.flight ? current.current.flights.flights.find(f => f.id === el.dataset.flight) : undefined;
        const point = coordinate(flight?.position.lat ?? Number(el.dataset.lat), flight?.position.lon ?? Number(el.dataset.lon), 1.012);
        const visible = point.dot(camera.position.clone().sub(point)) > 0;
        point.project(camera);
        el.style.display = visible && point.z > -1 && point.z < 1 && Math.abs(point.x) < 1 && Math.abs(point.y) < 1 && (Boolean(flight) || visibility.current.landmarks) ? "block" : "none";
        el.style.transform = `translate(${(point.x + 1) * width / 2}px, ${(1 - point.y) * height / 2}px) translate(8px, -50%)`;
      });
      renderer.render(scene, camera);
    };
    animate();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      controller.current = null;
      renderer.domElement.removeEventListener("pointerdown", pointerDown);
      renderer.domElement.removeEventListener("pointerup", pointerUp);
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      releaseGroup(routes);
      for (const child of grid.children)
        if (child instanceof THREE.Line) child.geometry.dispose();
      gridMaterial.dispose();
      [
        earthGeometry,
        atmosphereGeometry,
        planeGeometry,
        airportGeometry,
        selectedRingGeometry,
      ].forEach((g) => g.dispose());
      [
        earthMaterial,
        atmosphereMaterial,
        planeMaterial,
        stoppedMaterial,
        airportMaterial,
        selectedRingMaterial,
      ].forEach((m) => m.dispose());
      releaseGroup(coasts);
      releaseGroup(comms);
      releaseGroup(hubs);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [fallback]);

  useEffect(() => {
    controller.current?.reset();
  }, [props.region]);

  if (fallback) return <MissionGlobe {...props} />;
  return (
    <div className="webgl-scene" style={{ position: "relative", overflow: "hidden" }}>
      <div className="globe-renderer" ref={container} />
      <div ref={overlay} className="globe-landmarks" style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
        {SERVICE_HUBS.map(h => <button key={h.id} data-lat={h.lat} data-lon={h.lon} title={`${h.city} · ${h.label}`} onClick={() => props.onSelectNode?.(h.id)} style={{ position: "absolute", top: 0, left: 0, display: "none", pointerEvents: "auto", color: healthColor(props.nodes, h.id), background: "#06131ee8", border: "1px solid currentColor", borderRadius: 3, padding: "4px 6px", font: "10px monospace", whiteSpace: "nowrap", boxShadow: "0 0 12px #38bdf822" }}>{h.code} · {h.short}</button>)}
        {[...new Map(props.flights.flights.flatMap(f => [[f.from.code, f.from] as const, [f.to.code, f.to] as const])).values()].filter(a => !SERVICE_HUBS.some(h => h.code === a.code)).map(a => <span key={a.code} data-lat={a.lat} data-lon={a.lon} style={{ position: "absolute", top: 0, left: 0, display: "none", color: "#a6c7d8", font: "9px monospace", textShadow: "0 1px 3px #000" }}>{a.code}</span>)}
        {props.flights.flights.filter(f => props.selected === f.id).map(f => <button key={f.id} data-flight={f.id} data-lat={f.position.lat} data-lon={f.position.lon} onClick={() => props.onSelect?.(f.id)} style={{ position: "absolute", top: 0, left: 0, display: "none", pointerEvents: "auto", color: "#e7f3fb", background: "#06131e", border: "1px solid #38bdf8", font: "10px monospace" }}>{f.callsign}</button>)}
      </div>
      <span className="earth-credit">PROCEDURAL VECTOR EARTH · SIMULATED TRAFFIC</span>
      <div className="globe-controls">
        <button aria-pressed={commsVisible} onClick={() => setCommsVisible(v => !v)}>COMMS LINKS</button>
        <button aria-pressed={landmarksVisible} onClick={() => setLandmarksVisible(v => !v)}>LANDMARKS</button>
        <button onClick={() => controller.current?.reset()}>Recenter</button>
        <button
          aria-label="Zoom in"
          onClick={() => controller.current?.zoom(-0.25)}
        >
          +
        </button>
        <button
          aria-label="Zoom out"
          onClick={() => controller.current?.zoom(0.25)}
        >
          −
        </button>
      </div>
      <label className="aircraft-picker">
        Flight
        <select
          value={props.selected ?? ""}
          onChange={(e) => props.onSelect?.(e.target.value)}
        >
          <option value="">Select aircraft</option>
          {props.flights.flights.map((f) => (
            <option key={f.id} value={f.id}>
              {f.callsign} / {f.from.code} → {f.to.code}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
