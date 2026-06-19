import {
  Activity,
  Bike,
  ChevronDown,
  Check,
  CircleHelp,
  Gauge,
  LayoutDashboard,
  Map,
  Play,
  RotateCcw,
  Save,
  Settings2,
  SlidersHorizontal,
  Target,
  Timer,
  Upload,
  User,
  Weight,
  Wind
} from "lucide-react";
import {
  ChangeEvent,
  Dispatch,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  SetStateAction,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { calculateBbsBikeValues, type BbsBikeCalculatedValues } from "./lib/bbsBikeModel";
import {
  PreparedRoute,
  RawRoutePoint,
  computeCumulativeDistance,
  interpolateAtDistance,
  prepareRoute,
  type RoutePoint
} from "./lib/geo";
import { parseGpx } from "./lib/gpx";
import {
  buildScenarioComparisons,
  defaultProfile,
  defaultWeather,
  RiderBikeProfile,
  simulateCourse,
  SimulationMode,
  SimulationResult,
  WeatherProfile
} from "./lib/simulation";
import {
  formatDeltaTime,
  formatDistance,
  formatMeters,
  formatPercent,
  formatSpeed,
  formatTime,
  formatWatts
} from "./lib/format";

const modeLabels: Record<SimulationMode, string> = {
  power: "Leistung",
  goal: "Zielzeit",
  pacing: "Terrain"
};

const modeHelp: Record<SimulationMode, string> = {
  power: "Konstante Leistung: jedes Segment wird mit Zielpower gerechnet. Steigungen, Abfahrten und Kurven aendern nur die Geschwindigkeit.",
  goal: "Zielzeit-Modus: das Modell sucht eine konstante Leistung, mit der die eingegebene Zielzeit erreicht wird.",
  pacing: "Terrain-Modus: Leistung wird auf Berge und Kurvenausgaenge verschoben und danach wieder auf die Zielpower normalisiert."
};

const pacingFieldHelp = {
  targetPower:
    "Anker der Prediction. Im Terrain-Modus ist das der Ziel-Mittelwert, um den die Leistungsplanung herum verteilt wird.",
  minPower:
    "Untere Grenze fuer geplante Leistung. Verhindert, dass Abfahrten oder leichte Passagen unrealistisch stark auf Null fallen.",
  maxPower:
    "Harte Obergrenze fuer geplante Leistung. Berg- und Kurven-Boosts werden nie oberhalb dieses Werts geplant.",
  pacingAggression:
    "Steuert, wie stark Leistung verschoben wird. 0 faehrt fast konstant, 1 nutzt Berge und Kurvenausgaenge deutlich aggressiver.",
  cornerExit:
    "Zusaetzlicher Leistungsimpuls nach engen Richtungswechseln. Modelliert das Beschleunigen nach dem Abbremsen in Kurven.",
  exitDistance:
    "Strecke nach einer Kurve, ueber die der Kurven-Exit-Boost auslaeuft. Kleine Werte erzeugen kurze Peaks, grosse Werte verteilen den Druck.",
  cornerBrake:
    "Empfindlichkeit der Kurvenbremse. 0 ignoriert Kurven, 1 reduziert die Geschwindigkeit bei engen Richtungswechseln am staerksten.",
  minCorner:
    "Untere Geschwindigkeitsgrenze in engen Kurven. Das Modell bremst nicht unter diesen Wert.",
  climbSwitch:
    "Umschaltpunkt fuer die Climbing-CdA. Bei Segmenten steiler als ca. 1,2% und Geschwindigkeit darunter wird die Climb-Position verwendet."
};

const EQUIPMENT_CDA_M2 = 0.06;

type ActiveView = "simulator" | "profile" | "bike" | "courses" | "racePlans" | "raceDetails";
type ChartAxis = "distance" | "time";
type DragMethod = "basic" | "fit" | "manual";

interface AthleteProfile {
  heightCm: number;
  scaleCdaByRiderSize: boolean;
  cdaScalePct?: number;
}

interface BikeSetupProfile {
  bikeName: string;
  bikeType: string;
  components: string;
  frontWheelType: string;
  frontWheelWidth: string;
  rearWheelType: string;
  rearWheelWidth: string;
  tireType: string;
  tubeType: string;
  racingPosition: string;
  climbingPosition: string;
  helmetType: string;
  dragMethod: DragMethod;
  shoulderWidth: string;
  hipWidth: string;
  handleWidthRacing: string;
  handleWidthClimbing: string;
  hipToShoulder: string;
  hipToHead: string;
  seatToHandlebarDrop: string;
  torsoAngleRacing: string;
  torsoAngleClimbing: string;
  seatTubeAngle: string;
  cdaRacingByYaw: Record<string, number>;
  cdaClimbingByYaw: Record<string, number>;
}

interface RacePlan {
  id: string;
  name: string;
  courseName: string;
  bikeName: string;
  createdAt: string;
  mode: SimulationMode;
  distanceM: number;
  ascentM: number;
  descentM: number;
  totalTimeSec: number;
  averageSpeedMps: number;
  averagePowerW: number;
  normalizedPowerW: number;
  solvedPowerW?: number;
  riderWeightKg: number;
  bikeWeightKg: number;
  ftpW: number;
  cdaRace: number;
  cdaClimb: number;
  crr: number;
  drivetrainLossPct: number;
  cdaScale: number;
  weather: WeatherProfile;
  points?: RawRoutePoint[];
  segments: Array<{
    index: number;
    startDistanceM: number;
    endDistanceM: number;
    distanceM: number;
    grade: number;
    powerW: number;
    timeSec: number;
    speedMps: number;
    cda: number;
    yawDeg: number;
    headwindMps: number;
    position: "race" | "climb";
  }>;
}

interface SavedCourse {
  id: string;
  name: string;
  createdAt: string;
  totalDistanceM: number;
  totalAscentM: number;
  totalDescentM: number;
  points: RawRoutePoint[];
}

interface SimulationRun {
  route: PreparedRoute;
  result: SimulationResult;
  profile: RiderBikeProfile;
  baseProfile: RiderBikeProfile;
  bikeSetup: BikeSetupProfile;
  weather: WeatherProfile;
  mode: SimulationMode;
  goalTimeSec: number;
  riderCdaScale: number;
}

const defaultAthleteProfile: AthleteProfile = {
  heightCm: 190,
  scaleCdaByRiderSize: true
};

const defaultBikeSetupProfile: BikeSetupProfile = {
  bikeName: "Fuji",
  bikeType: "Tri/TT (entry level)",
  components: "Mid Range",
  frontWheelType: "Medium Depth (60s)",
  frontWheelWidth: "Wide",
  rearWheelType: "Disc",
  rearWheelWidth: "Wide",
  tireType: "Clincher (wide 25-28)",
  tubeType: "Latex",
  racingPosition: "Aerobars (Advanced Triathlete)",
  climbingPosition: "Upright",
  helmetType: "Aero",
  dragMethod: "basic",
  shoulderWidth: "",
  hipWidth: "",
  handleWidthRacing: "",
  handleWidthClimbing: "",
  hipToShoulder: "",
  hipToHead: "",
  seatToHandlebarDrop: "",
  torsoAngleRacing: "",
  torsoAngleClimbing: "",
  seatTubeAngle: "",
  cdaRacingByYaw: {
    "0": 0.2628,
    "5": 0.2607,
    "10": 0.2489,
    "15": 0.2452,
    "20": 0.236
  },
  cdaClimbingByYaw: {
    "0": 0.4133,
    "5": 0.4109,
    "10": 0.3989,
    "15": 0.3922,
    "20": 0.3796
  }
};

const bikeTypeOptions = ["Road", "Aero Road", "Tri/TT (entry level)", "Tri/TT", "Gravel", "Mountain"];
const componentOptions = ["High End", "Mid Range", "Entry Level"];
const frontWheelTypeOptions = [
  "Standard Box Rim",
  "Minimal Depth (30s)",
  "Medium Depth (60s)",
  "Deep Depth (90s)",
  "Tri-Spoke"
];
const rearWheelTypeOptions = [...frontWheelTypeOptions, "Disc"];
const wheelWidthOptions = ["Narrow", "Wide"];
const tireTypeOptions = [
  "Clincher (narrow 19-21)",
  "Clincher (medium 22-24)",
  "Clincher (wide 25-28)",
  "Clincher (wider 30+)",
  "Tubular (narrow 19-21)",
  "Tubular (medium 22-24)",
  "Tubular (wide 25-28)",
  "Tubular (wider 30+)",
  "Gravel Tires",
  "Mountain Bike Tires"
];
const tubeTypeOptions = ["Butyl", "Latex", "Tubeless"];
const racingPositionOptions = [
  "Tops",
  "Hoods",
  "Drops",
  "Aerobars (Recreational Triathlete)",
  "Aerobars (Midpack Triathlete)",
  "Aerobars (Advanced Triathlete)",
  "Aerobars (Elite/Pro Time Trial)",
  "Mountain Bike Bars"
];
const climbingPositionOptions = ["Upright", "Tops", "Hoods/Bullhorns", "Mountain Bike Bars"];
const helmetTypeOptions = ["Road", "Aero", "Mountain"];

export default function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [route, setRoute] = useState<PreparedRoute | null>(null);
  const [profile, setProfile] = useStoredState<RiderBikeProfile>("aerosplit.profile", defaultProfile);
  const [athleteProfile, setAthleteProfile] = useStoredState<AthleteProfile>(
    "aerosplit.athleteProfile",
    defaultAthleteProfile
  );
  const [bikeSetup, setBikeSetup] = useStoredState<BikeSetupProfile>(
    "aerosplit.bikeSetup",
    defaultBikeSetupProfile
  );
  const [racePlans, setRacePlans] = useStoredState<RacePlan[]>("aerosplit.racePlans", []);
  const [activeRacePlanId, setActiveRacePlanId] = useStoredState<string>("aerosplit.activeRacePlanId", "");
  const [savedCourses, setSavedCourses] = useStoredState<SavedCourse[]>("aerosplit.savedCourses", []);
  const [weather, setWeather] = useStoredState<WeatherProfile>("aerosplit.weather", defaultWeather);
  const [mode, setMode] = useStoredState<SimulationMode>("aerosplit.mode", "power");
  const [activeView, setActiveView] = useStoredState<ActiveView>("aerosplit.activeView", "simulator");
  const currentView: ActiveView =
    activeView === "profile" || activeView === "bike" || activeView === "courses" || activeView === "racePlans" || activeView === "raceDetails"
      ? activeView
      : "simulator";
  const [goalHours, setGoalHours] = useStoredState<number>("aerosplit.goalHours", 5);
  const [goalMinutes, setGoalMinutes] = useStoredState<number>("aerosplit.goalMinutes", 5);
  const [importError, setImportError] = useState("");
  const [simulationRun, setSimulationRun] = useState<SimulationRun | null>(null);

  const goalTimeSec = goalHours * 3600 + goalMinutes * 60;
  const suggestedRiderCdaScale = useMemo(
    () => calculateSuggestedRiderCdaScale(athleteProfile, profile.riderWeightKg),
    [athleteProfile.heightCm, profile.riderWeightKg]
  );
  const riderCdaScale = useMemo(
    () => calculateRiderCdaScale(athleteProfile, suggestedRiderCdaScale),
    [athleteProfile.cdaScalePct, athleteProfile.scaleCdaByRiderSize, suggestedRiderCdaScale]
  );
  const predictionProfile = useMemo(
    () => applyRiderCdaScaleToProfile(profile, riderCdaScale),
    [profile, riderCdaScale]
  );
  const maxSurgePct = clampNumber(profile.maxPowerSurgePct, 0, 50);
  const effectivePowerCeiling = Math.min(profile.maxPowerW, profile.targetPowerW * (1 + maxSurgePct / 100));
  const result = simulationRun?.result ?? null;
  const hasPendingSimulation = Boolean(
    route &&
      (!simulationRun ||
        simulationRun.route !== route ||
        simulationRun.profile !== predictionProfile ||
        simulationRun.baseProfile !== profile ||
        simulationRun.bikeSetup !== bikeSetup ||
        simulationRun.weather !== weather ||
        simulationRun.mode !== mode ||
        simulationRun.goalTimeSec !== goalTimeSec ||
        simulationRun.riderCdaScale !== riderCdaScale)
  );
  const comparisons = useMemo(
    () => {
      if (!simulationRun) {
        return [];
      }

      const effectiveProfile = {
        ...simulationRun.profile,
        targetPowerW: simulationRun.result.solvedPowerW ?? simulationRun.profile.targetPowerW
      };

      return buildScenarioComparisons(
        simulationRun.route.segments,
        effectiveProfile,
        simulationRun.weather,
        simulationRun.result,
        simulationRun.mode === "goal" ? "power" : simulationRun.mode
      );
    },
    [simulationRun]
  );
  const activeRacePlan = useMemo(
    () => racePlans.find((plan) => plan.id === activeRacePlanId) ?? racePlans[0] ?? null,
    [activeRacePlanId, racePlans]
  );
  useEffect(() => {
    if (bikeSetup.dragMethod === "manual" || bikeSetup.dragMethod === "fit") {
      return;
    }

    const calculated = deriveBbsBikeCalculatedValues(bikeSetup);
    setBikeSetup((current) =>
      current.dragMethod === "manual" || current.dragMethod === "fit"
        ? current
        : {
            ...current,
            cdaRacingByYaw: calculated.cdaRacingByYaw,
            cdaClimbingByYaw: calculated.cdaClimbingByYaw
          }
    );
    applyBbsCalculatedToProfile(setProfile, calculated);
  }, [
    bikeSetup.bikeType,
    bikeSetup.components,
    bikeSetup.frontWheelType,
    bikeSetup.frontWheelWidth,
    bikeSetup.rearWheelType,
    bikeSetup.rearWheelWidth,
    bikeSetup.tireType,
    bikeSetup.tubeType,
    bikeSetup.racingPosition,
    bikeSetup.climbingPosition,
    bikeSetup.helmetType,
    bikeSetup.dragMethod
  ]);

  const runSimulation = () => {
    if (!route) {
      return;
    }

    const nextResult = simulateCourse(route.segments, predictionProfile, weather, mode, goalTimeSec);
    setSimulationRun({
      route,
      result: nextResult,
      profile: predictionProfile,
      baseProfile: profile,
      bikeSetup,
      weather,
      mode,
      goalTimeSec,
      riderCdaScale
    });
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      setRoute(parseGpx(text, file.name));
      setSimulationRun(null);
      setImportError("");
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Import fehlgeschlagen.");
    } finally {
      event.target.value = "";
    }
  };

  const saveCurrentRacePlan = () => {
    if (!simulationRun) {
      return;
    }

    const plan = createRacePlanSnapshot({
      route: simulationRun.route,
      result: simulationRun.result,
      profile: simulationRun.profile,
      baseProfile: simulationRun.baseProfile,
      bikeSetup: simulationRun.bikeSetup,
      weather: simulationRun.weather,
      mode: simulationRun.mode,
      riderCdaScale: simulationRun.riderCdaScale
    });
    setRacePlans((current) => [plan, ...current]);
    setActiveRacePlanId(plan.id);
    setActiveView("raceDetails");
  };

  const openRacePlan = (id: string) => {
    setActiveRacePlanId(id);
    setActiveView("raceDetails");
  };

  const deleteRacePlan = (id: string) => {
    setRacePlans((current) => current.filter((plan) => plan.id !== id));
    if (activeRacePlanId === id) {
      setActiveRacePlanId("");
      setActiveView("racePlans");
    }
  };

  const saveCurrentCourse = () => {
    if (!route) {
      return;
    }

    const course = createSavedCourse(route);
    setSavedCourses((current) => [course, ...current.filter((item) => item.name !== course.name)]);
    setActiveView("courses");
  };

  const openSavedCourse = (id: string) => {
    const course = savedCourses.find((item) => item.id === id);
    if (!course) {
      return;
    }
    setRoute(prepareRoute(course.name, course.points, 50, 9));
    setSimulationRun(null);
    setImportError("");
    setActiveView("simulator");
  };

  const deleteSavedCourse = (id: string) => {
    setSavedCourses((current) => current.filter((course) => course.id !== id));
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Bike size={22} strokeWidth={2.4} />
          </div>
          <div>
            <h1>Best Bike Split</h1>
            <p>Local Model</p>
          </div>
        </div>
        <nav className="top-nav" aria-label="Main views">
          <button className={currentView === "simulator" ? "active" : ""} type="button" onClick={() => setActiveView("simulator")}>
            <Gauge size={17} />
            Dashboard
          </button>
          <button className={currentView === "profile" ? "active" : ""} type="button" onClick={() => setActiveView("profile")}>
            <User size={17} />
            Profile
          </button>
          <button className={currentView === "bike" ? "active" : ""} type="button" onClick={() => setActiveView("bike")}>
            <Bike size={17} />
            Bikes
          </button>
          <button className={currentView === "courses" ? "active" : ""} type="button" onClick={() => setActiveView("courses")}>
            <Map size={17} />
            Courses
          </button>
          <button className={currentView === "racePlans" || currentView === "raceDetails" ? "active" : ""} type="button" onClick={() => setActiveView("racePlans")}>
            <Target size={17} />
            Race Plans
          </button>
        </nav>
        <div className="top-actions">
          <button className="button secondary" type="button" onClick={() => fileInputRef.current?.click()}>
            <Upload size={17} />
            GPX
          </button>
          <input ref={fileInputRef} className="visually-hidden" type="file" accept=".gpx,application/gpx+xml" onChange={handleFile} />
        </div>
      </header>

      {currentView === "profile" ? (
        <ProfileView
          athleteProfile={athleteProfile}
          setAthleteProfile={setAthleteProfile}
          profile={profile}
          setProfile={setProfile}
          route={route}
          result={result}
          riderCdaScale={riderCdaScale}
          suggestedRiderCdaScale={suggestedRiderCdaScale}
          hasPendingSimulation={hasPendingSimulation}
          importError={importError}
          onImportGpx={() => fileInputRef.current?.click()}
          onRunSimulation={runSimulation}
          activeView={currentView}
          setActiveView={setActiveView}
        />
      ) : currentView === "bike" ? (
        <BikeProfileView
          bikeSetup={bikeSetup}
          setBikeSetup={setBikeSetup}
          profile={profile}
          setProfile={setProfile}
          route={route}
          result={result}
          hasPendingSimulation={hasPendingSimulation}
          importError={importError}
          onImportGpx={() => fileInputRef.current?.click()}
          onRunSimulation={runSimulation}
          activeView={currentView}
          setActiveView={setActiveView}
        />
      ) : currentView === "courses" ? (
        <CoursesView
          savedCourses={savedCourses}
          currentRoute={route}
          onSaveCurrent={saveCurrentCourse}
          onOpenCourse={openSavedCourse}
          onDeleteCourse={deleteSavedCourse}
          onImportGpx={() => fileInputRef.current?.click()}
          activeView={currentView}
          setActiveView={setActiveView}
        />
      ) : currentView === "racePlans" ? (
        <RacePlansView
          racePlans={racePlans}
          route={route}
          result={result}
          onSaveCurrent={saveCurrentRacePlan}
          onOpenPlan={openRacePlan}
          onDeletePlan={deleteRacePlan}
          onImportGpx={() => fileInputRef.current?.click()}
          activeView={currentView}
          setActiveView={setActiveView}
        />
      ) : currentView === "raceDetails" ? (
        <RaceDetailsView
          racePlan={activeRacePlan}
          onBack={() => setActiveView("racePlans")}
          onDeletePlan={deleteRacePlan}
          activeView={currentView}
          setActiveView={setActiveView}
        />
      ) : (
        <main className="workspace">
          <aside className="control-column">
            <Panel icon={<Map size={18} />} title="Kurs">
              <CourseEvaluation
                route={route}
                result={result}
                hasPendingSimulation={hasPendingSimulation}
                onImportGpx={() => fileInputRef.current?.click()}
                onRunSimulation={runSimulation}
              />
              {route && (
                <>
                  <RouteMap route={route} compact />
                  <button className="button secondary full-button" type="button" onClick={saveCurrentCourse}>
                    <Save size={17} />
                    Kurs speichern
                  </button>
                </>
              )}
              {importError && <p className="error-line">{importError}</p>}
            </Panel>

            <Panel icon={<Weight size={18} />} title="Athlet & Bike">
              <div className="field-grid">
                <NumberField label="Fahrer" value={profile.riderWeightKg} unit="kg" min={45} max={130} step={0.5} onChange={(value) => setProfileField(setProfile, "riderWeightKg", value)} />
                <NumberField label="Groesse" value={athleteProfile.heightCm} unit="cm" min={120} max={230} step={1} onChange={(value) => setAthleteField(setAthleteProfile, "heightCm", value)} />
                <NumberField label="Bike" value={profile.bikeWeightKg} unit="kg" min={5} max={18} step={0.2} onChange={(value) => setProfileField(setProfile, "bikeWeightKg", value)} />
                <NumberField label="FTP" value={profile.ftpW} unit="W" min={120} max={480} step={5} onChange={(value) => setProfileField(setProfile, "ftpW", value)} />
                <NumberField label="CdA Race" value={profile.cdaRace} unit="m2" min={0.18} max={0.45} step={0.005} onChange={(value) => setProfileField(setProfile, "cdaRace", value)} />
                <NumberField label="CdA Climb" value={profile.cdaClimb} unit="m2" min={0.2} max={0.55} step={0.005} onChange={(value) => setProfileField(setProfile, "cdaClimb", value)} />
                <NumberField label="Crr" value={profile.crr} unit="" min={0.002} max={0.012} step={0.0001} onChange={(value) => setProfileField(setProfile, "crr", value)} />
                <NumberField label="Antrieb" value={profile.drivetrainLossPct} unit="%" min={0} max={8} step={0.1} onChange={(value) => setProfileField(setProfile, "drivetrainLossPct", value)} />
                <NumberField label="Max Speed" value={profile.maxSpeedKph} unit="km/h" min={35} max={100} step={1} onChange={(value) => setProfileField(setProfile, "maxSpeedKph", value)} />
              </div>
              <label className="toggle-line dashboard-toggle">
                <input
                  type="checkbox"
                  checked={athleteProfile.scaleCdaByRiderSize !== false}
                  onChange={(event) => setAthleteField(setAthleteProfile, "scaleCdaByRiderSize", event.target.checked)}
                />
                <span>CdA Scale ({(riderCdaScale * 100).toFixed(1)}%)</span>
              </label>
              {athleteProfile.scaleCdaByRiderSize !== false && (
                <div className="cda-scale-controls">
                  <NumberField
                    label="CdA Scale"
                    help="Dieser Prozentwert wird in der Prediction auf den fahrerabhaengigen Anteil der CdA angewendet. Der Formelwert ist nur der Vorschlag; hier kannst du ihn manuell korrigieren."
                    value={riderCdaScale * 100}
                    unit="%"
                    min={70}
                    max={140}
                    step={0.1}
                    onChange={(value) => setAthleteField(setAthleteProfile, "cdaScalePct", value)}
                  />
                  <button
                    className="button ghost cda-scale-reset"
                    type="button"
                    onClick={() => setAthleteField(setAthleteProfile, "cdaScalePct", round1(suggestedRiderCdaScale * 100))}
                  >
                    Formel {round1(suggestedRiderCdaScale * 100).toFixed(1)}%
                  </button>
                </div>
              )}
            </Panel>

            <Panel icon={<Wind size={18} />} title="Wetter">
              <div className="field-grid">
                <NumberField label="Wind" value={weather.windSpeedKph} unit="km/h" min={0} max={55} step={1} onChange={(value) => setWeatherField(setWeather, "windSpeedKph", value)} />
                <NumberField label="Richtung" value={weather.windDirectionDeg} unit="deg" min={0} max={359} step={5} onChange={(value) => setWeatherField(setWeather, "windDirectionDeg", value)} />
                <NumberField label="Temp." value={weather.tempC} unit="C" min={-5} max={45} step={1} onChange={(value) => setWeatherField(setWeather, "tempC", value)} />
                <NumberField label="Druck" value={weather.pressureHpa} unit="hPa" min={900} max={1050} step={1} onChange={(value) => setWeatherField(setWeather, "pressureHpa", value)} />
                <NumberField label="Feuchte" value={weather.humidityPct} unit="%" min={0} max={100} step={5} onChange={(value) => setWeatherField(setWeather, "humidityPct", value)} />
              </div>
            </Panel>

            <Panel icon={<SlidersHorizontal size={18} />} title="Pacing">
              <div className="segmented" role="tablist" aria-label="Pacing-Modus">
                {(Object.keys(modeLabels) as SimulationMode[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={mode === key ? "active" : ""}
                    onClick={() => setMode(key)}
                  >
                    <span>{modeLabels[key]}</span>
                    <HelpTip text={modeHelp[key]} focusable={false} />
                  </button>
                ))}
              </div>

              <RangeField label="Zielpower" help={pacingFieldHelp.targetPower} value={profile.targetPowerW} min={90} max={profile.maxPowerW} step={1} unit="W" onChange={(value) => setProfileField(setProfile, "targetPowerW", value)} />

              {mode === "goal" && (
                <div className="field-grid two-column">
                  <NumberField label="Stunden" help="Zielzeit-Stunden fuer den Zielzeit-Modus. Das Modell sucht die konstante Leistung fuer diese Bike-Split-Zeit." value={goalHours} unit="h" min={3} max={9} step={1} onChange={setGoalHours} />
                  <NumberField label="Minuten" help="Zielzeit-Minuten fuer den Zielzeit-Modus. Zusammen mit Stunden ergibt das die gewuenschte Bike-Split-Zeit." value={goalMinutes} unit="min" min={0} max={59} step={5} onChange={setGoalMinutes} />
                </div>
              )}

              {mode === "pacing" && (
                <>
                  <RangeField label="Terrain-Faktor" help={pacingFieldHelp.pacingAggression} value={profile.pacingAggression} min={0} max={1} step={0.05} unit="" onChange={(value) => setProfileField(setProfile, "pacingAggression", value)} />
                  <div className="field-grid two-column">
                    <NumberField label="Min W" help={pacingFieldHelp.minPower} value={profile.minPowerW} unit="W" min={40} max={profile.targetPowerW} step={5} onChange={(value) => setProfileField(setProfile, "minPowerW", value)} />
                    <NumberField label="Max W" help={pacingFieldHelp.maxPower} value={profile.maxPowerW} unit="W" min={profile.targetPowerW} max={420} step={5} onChange={(value) => setProfileField(setProfile, "maxPowerW", value)} />
                    <NumberField
                      label="Max Boost"
                      help={`Prozentuale Obergrenze ueber Zielpower. Bei ${formatWatts(profile.targetPowerW)} und ${maxSurgePct.toFixed(0)}% waere die Boost-Decke ${formatWatts(profile.targetPowerW * (1 + maxSurgePct / 100))}; mit Max W effektiv ${formatWatts(effectivePowerCeiling)}.`}
                      value={profile.maxPowerSurgePct}
                      unit="%"
                      min={0}
                      max={50}
                      step={1}
                      onChange={(value) => setProfileField(setProfile, "maxPowerSurgePct", value)}
                    />
                    <NumberField label="Kurven-Exit" help={pacingFieldHelp.cornerExit} value={profile.cornerExitBoostPct} unit="%" min={0} max={35} step={1} onChange={(value) => setProfileField(setProfile, "cornerExitBoostPct", value)} />
                    <NumberField label="Exit-Distanz" help={pacingFieldHelp.exitDistance} value={profile.cornerExitDistanceM} unit="m" min={0} max={1000} step={50} onChange={(value) => setProfileField(setProfile, "cornerExitDistanceM", value)} />
                    <NumberField label="Kurvenbremse" help={pacingFieldHelp.cornerBrake} value={profile.cornerBrakeSensitivity} unit="" min={0} max={1} step={0.05} onChange={(value) => setProfileField(setProfile, "cornerBrakeSensitivity", value)} />
                    <NumberField label="Min Kurve" help={pacingFieldHelp.minCorner} value={profile.minCornerSpeedKph} unit="km/h" min={8} max={55} step={1} onChange={(value) => setProfileField(setProfile, "minCornerSpeedKph", value)} />
                  </div>
                </>
              )}

              <NumberField label="Climb Switch" help={pacingFieldHelp.climbSwitch} value={profile.positionSwitchKph} unit="km/h" min={12} max={35} step={1} onChange={(value) => setProfileField(setProfile, "positionSwitchKph", value)} />
            </Panel>
          </aside>

          <section className="results-column">
            {simulationRun ? (
              <>
                <section className="summary-band">
                  <Metric icon={<Timer size={20} />} label="Bike Split" value={formatTime(simulationRun.result.summary.totalTimeSec)} accent="green" />
                  <Metric icon={<Gauge size={20} />} label="Schnitt" value={formatSpeed(simulationRun.result.summary.averageSpeedMps)} accent="blue" />
                  <Metric icon={<Activity size={20} />} label={simulationRun.result.solvedPowerW ? "Erforderlich" : "Avg Power"} value={formatWatts(simulationRun.result.solvedPowerW ?? simulationRun.result.summary.averagePowerW)} accent="orange" />
                  <Metric icon={<Target size={20} />} label="Normalized Power" value={formatWatts(simulationRun.result.summary.normalizedPowerW)} accent="gray" />
                </section>

                <div className="dashboard-actions">
                  <button className="button secondary" type="button" onClick={runSimulation} disabled={!route}>
                    <Play size={17} />
                    Neu berechnen
                  </button>
                  <button className="button secondary" type="button" onClick={saveCurrentRacePlan}>
                    <Save size={17} />
                    Race Plan speichern
                  </button>
                  <button className="button ghost" type="button" onClick={() => setActiveView("racePlans")}>
                    <Target size={17} />
                    Race Plans
                  </button>
                  {hasPendingSimulation && <span className="pending-pill">Änderungen nicht berechnet</span>}
                </div>

                <section className="analysis-layout">
                  <Panel icon={<ChevronDown size={18} />} title="Profil">
                    <ElevationChart route={simulationRun.route} />
                  </Panel>
                  <Panel icon={<Play size={18} />} title="Leistung">
                    <PowerChart result={simulationRun.result} ftpW={simulationRun.baseProfile.ftpW} />
                  </Panel>
                </section>

                <Panel icon={<Settings2 size={18} />} title="Szenarien">
                  <div className="scenario-grid">
                    {comparisons.map((item) => (
                      <div className="scenario" key={item.id}>
                        <span>{item.value}</span>
                        <strong>{item.label}</strong>
                        <b className={item.deltaSec < 0 ? "good" : "bad"}>{formatDeltaTime(item.deltaSec)}</b>
                      </div>
                    ))}
                  </div>
                </Panel>

                <Panel icon={<Map size={18} />} title="Segmente">
                  <SegmentTable result={simulationRun.result} ftpW={simulationRun.baseProfile.ftpW} />
                </Panel>
              </>
            ) : route ? (
              <section className="empty-route-panel">
                <Play size={34} />
                <h2>Kurs geladen</h2>
                <p>Die GPX ist bereit. Die Prediction wird erst gerechnet, wenn du den Button drückst.</p>
                <button className="button secondary" type="button" onClick={runSimulation}>
                  <Play size={17} />
                  Prediction berechnen
                </button>
              </section>
            ) : (
              <section className="empty-route-panel">
                <Map size={34} />
                <h2>Kein Kurs geladen</h2>
                <p>Lade eine GPX-Datei, dann werden Kursprofil, Segmente, Bike Split und Szenarien mit den aktuellen Profilwerten berechnet.</p>
                <button className="button secondary" type="button" onClick={() => fileInputRef.current?.click()}>
                  <Upload size={17} />
                  GPX laden
                </button>
              </section>
            )}
          </section>
        </main>
      )}
    </div>
  );
}

function Panel({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-title">
        {icon}
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Metric({ icon, label, value, accent }: { icon: ReactNode; label: string; value: string; accent: string }) {
  return (
    <div className={`metric ${accent}`}>
      <span className="metric-icon">{icon}</span>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CourseEvaluation({
  route,
  result,
  hasPendingSimulation = false,
  onImportGpx,
  onRunSimulation
}: {
  route: PreparedRoute | null;
  result: SimulationResult | null;
  hasPendingSimulation?: boolean;
  onImportGpx: () => void;
  onRunSimulation?: () => void;
}) {
  if (!route) {
    return (
      <div className="course-empty">
        <p>Keine GPX geladen.</p>
        <button className="button secondary" type="button" onClick={onImportGpx}>
          <Upload size={17} />
          GPX laden
        </button>
      </div>
    );
  }

  return (
    <div className="course-evaluation">
      <div className="course-title-row">
        <strong>{route.name}</strong>
        <div className="course-title-actions">
          {onRunSimulation && (
            <button className="button secondary" type="button" onClick={onRunSimulation}>
              <Play size={17} />
              {result ? "Neu berechnen" : "Prediction berechnen"}
            </button>
          )}
          <button className="button ghost" type="button" onClick={onImportGpx}>
            <Upload size={17} />
            GPX ersetzen
          </button>
        </div>
      </div>
      <div className="stat-grid two">
        <Stat label="Distanz" value={formatDistance(route.totalDistanceM)} />
        <Stat label="Segments" value={String(route.segments.length)} />
        <Stat label="Anstieg" value={formatMeters(route.totalAscentM)} />
        <Stat label="Abfahrt" value={formatMeters(route.totalDescentM)} />
        <Stat label="Bike Split" value={result ? formatTime(result.summary.totalTimeSec) : "offen"} />
        <Stat label="Avg Power" value={result ? formatWatts(result.solvedPowerW ?? result.summary.averagePowerW) : "offen"} />
        <Stat label="NP" value={result ? formatWatts(result.summary.normalizedPowerW) : "offen"} />
      </div>
      {hasPendingSimulation && result && <p className="stale-note">Eingaben geändert. Ergebnis ist noch nicht neu berechnet.</p>}
    </div>
  );
}

function CoursesView({
  savedCourses,
  currentRoute,
  onSaveCurrent,
  onOpenCourse,
  onDeleteCourse,
  onImportGpx,
  activeView,
  setActiveView
}: {
  savedCourses: SavedCourse[];
  currentRoute: PreparedRoute | null;
  onSaveCurrent: () => void;
  onOpenCourse: (id: string) => void;
  onDeleteCourse: (id: string) => void;
  onImportGpx: () => void;
  activeView: ActiveView;
  setActiveView: Dispatch<SetStateAction<ActiveView>>;
}) {
  return (
    <main className="profile-workspace">
      <section className="profile-main">
        <div className="page-strip">
          <h2>Courses</h2>
        </div>

        <section className="profile-form-surface">
          <div className="race-plan-actions">
            <button className="button secondary" type="button" onClick={onSaveCurrent} disabled={!currentRoute}>
              <Save size={17} />
              Aktuellen Kurs speichern
            </button>
            <button className="button ghost" type="button" onClick={onImportGpx}>
              <Upload size={17} />
              GPX laden
            </button>
          </div>

          {currentRoute && (
            <FormSection title="Aktueller Kurs">
              <CourseSummary route={currentRoute} />
              <RouteMap route={currentRoute} />
            </FormSection>
          )}

          {savedCourses.length === 0 ? (
            <section className="empty-route-panel compact-panel">
              <Map size={32} />
              <h2>Keine Kurse gespeichert</h2>
              <p>Lade eine GPX und speichere sie als lokalen Kurs.</p>
            </section>
          ) : (
            <div className="course-list">
              {savedCourses.map((course) => (
                <article className="course-card" key={course.id}>
                  <div>
                    <h3>{course.name}</h3>
                    <p>Saved {formatDateTime(course.createdAt)}</p>
                  </div>
                  <div className="race-plan-card-stats">
                    <Stat label="Distance" value={formatDistance(course.totalDistanceM)} />
                    <Stat label="Ascent" value={formatMeters(course.totalAscentM)} />
                    <Stat label="Descent" value={formatMeters(course.totalDescentM)} />
                  </div>
                  <RouteMap course={course} compact />
                  <div className="race-plan-card-actions">
                    <button className="button secondary" type="button" onClick={() => onOpenCourse(course.id)}>Öffnen</button>
                    <button className="button ghost" type="button" onClick={() => onDeleteCourse(course.id)}>Delete</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>

      <AccountRail activeView={activeView} setActiveView={setActiveView} />
    </main>
  );
}

function CourseSummary({ route }: { route: PreparedRoute }) {
  return (
    <div className="stat-grid two">
      <Stat label="Name" value={route.name} />
      <Stat label="Distance" value={formatDistance(route.totalDistanceM)} />
      <Stat label="Ascent" value={formatMeters(route.totalAscentM)} />
      <Stat label="Descent" value={formatMeters(route.totalDescentM)} />
    </div>
  );
}

function ProfileView({
  athleteProfile,
  setAthleteProfile,
  profile,
  setProfile,
  route,
  result,
  riderCdaScale,
  suggestedRiderCdaScale,
  hasPendingSimulation,
  importError,
  onImportGpx,
  onRunSimulation,
  activeView,
  setActiveView
}: {
  athleteProfile: AthleteProfile;
  setAthleteProfile: Dispatch<SetStateAction<AthleteProfile>>;
  profile: RiderBikeProfile;
  setProfile: Dispatch<SetStateAction<RiderBikeProfile>>;
  route: PreparedRoute | null;
  result: SimulationResult | null;
  riderCdaScale: number;
  suggestedRiderCdaScale: number;
  hasPendingSimulation: boolean;
  importError: string;
  onImportGpx: () => void;
  onRunSimulation: () => void;
  activeView: ActiveView;
  setActiveView: Dispatch<SetStateAction<ActiveView>>;
}) {
  return (
    <main className="profile-workspace">
      <section className="profile-main">
        <div className="page-strip">
          <h2>Profile <span>(update)</span></h2>
        </div>

        <section className="profile-form-surface">
          <FormSection title="Athlet & Leistung">
            <div className="profile-grid">
              <NumberField label="Groesse" value={athleteProfile.heightCm} unit="cm" min={120} max={230} step={1} onChange={(value) => setAthleteField(setAthleteProfile, "heightCm", value)} />
              <NumberField label="Gewicht" value={profile.riderWeightKg} unit="kg" min={45} max={130} step={0.5} onChange={(value) => setProfileField(setProfile, "riderWeightKg", value)} />
              <NumberField label="FTP" value={profile.ftpW} unit="W" min={120} max={520} step={5} onChange={(value) => setProfileField(setProfile, "ftpW", value)} />
            </div>
          </FormSection>

          <FormSection title="Prediction-CdA">
            <div className="calculated-row">
              <p className="calculated-note">
                Groesse und Gewicht werden nur in der Prediction fuer die CdA-Skalierung genutzt. Der Formelwert ist ein Vorschlag;
                du kannst den Prozentwert manuell korrigieren.
              </p>
              <div className="calculated-note cda-scale-note">
                Prediction-CdA-Skalierung: {(riderCdaScale * 100).toFixed(1)}% der Referenz
                <br />
                Formelvorschlag: {(suggestedRiderCdaScale * 100).toFixed(1)}%
              </div>
              <label className="toggle-line profile-toggle">
                <input
                  type="checkbox"
                  checked={athleteProfile.scaleCdaByRiderSize !== false}
                  onChange={(event) => setAthleteField(setAthleteProfile, "scaleCdaByRiderSize", event.target.checked)}
                />
                <span>Fahrergröße und Gewicht erst in der Prediction auf CdA anwenden</span>
              </label>
              {athleteProfile.scaleCdaByRiderSize !== false && (
                <div className="cda-scale-controls profile-cda-scale-controls">
                  <NumberField
                    label="CdA Scale"
                    help="Dieser Prozentwert wird in der Prediction auf den fahrerabhaengigen Anteil der CdA angewendet. Der Formelwert ist nur der Vorschlag; hier kannst du ihn manuell korrigieren."
                    value={riderCdaScale * 100}
                    unit="%"
                    min={70}
                    max={140}
                    step={0.1}
                    onChange={(value) => setAthleteField(setAthleteProfile, "cdaScalePct", value)}
                  />
                  <button
                    className="button ghost cda-scale-reset"
                    type="button"
                    onClick={() => setAthleteField(setAthleteProfile, "cdaScalePct", round1(suggestedRiderCdaScale * 100))}
                  >
                    Formel {round1(suggestedRiderCdaScale * 100).toFixed(1)}%
                  </button>
                </div>
              )}
            </div>
          </FormSection>

          <div className="save-status" aria-live="polite">
            <Save size={18} />
            Lokal gespeichert
          </div>

          <FormSection title="GPX-Auswertung">
            <CourseEvaluation
              route={route}
              result={result}
              hasPendingSimulation={hasPendingSimulation}
              onImportGpx={onImportGpx}
              onRunSimulation={onRunSimulation}
            />
            {importError && <p className="error-line">{importError}</p>}
          </FormSection>
        </section>
      </section>

      <AccountRail activeView={activeView} setActiveView={setActiveView} />
    </main>
  );
}

function BikeProfileView({
  bikeSetup,
  setBikeSetup,
  profile,
  setProfile,
  route,
  result,
  hasPendingSimulation,
  importError,
  onImportGpx,
  onRunSimulation,
  activeView,
  setActiveView
}: {
  bikeSetup: BikeSetupProfile;
  setBikeSetup: Dispatch<SetStateAction<BikeSetupProfile>>;
  profile: RiderBikeProfile;
  setProfile: Dispatch<SetStateAction<RiderBikeProfile>>;
  route: PreparedRoute | null;
  result: SimulationResult | null;
  hasPendingSimulation: boolean;
  importError: string;
  onImportGpx: () => void;
  onRunSimulation: () => void;
  activeView: ActiveView;
  setActiveView: Dispatch<SetStateAction<ActiveView>>;
}) {
  const activeDragMethod: DragMethod =
    bikeSetup.dragMethod === "fit" || bikeSetup.dragMethod === "manual" ? bikeSetup.dragMethod : "basic";

  function applyCalculatedValues(nextSetup: BikeSetupProfile) {
    const calculated = deriveBbsBikeCalculatedValues(nextSetup);
    setBikeSetup({
      ...nextSetup,
      cdaRacingByYaw: calculated.cdaRacingByYaw,
      cdaClimbingByYaw: calculated.cdaClimbingByYaw
    });
    applyBbsCalculatedToProfile(setProfile, calculated);
  }

  function updateBikeSetup<K extends keyof BikeSetupProfile>(key: K, value: BikeSetupProfile[K]) {
    const nextSetup = { ...bikeSetup, [key]: value };
    if (nextSetup.dragMethod !== "fit" && nextSetup.dragMethod !== "manual") {
      applyCalculatedValues(nextSetup);
      return;
    }
    setBikeSetup(nextSetup);
  }

  return (
    <main className="profile-workspace">
      <section className="profile-main">
        <div className="page-strip">
          <h2>Bike <span>(update)</span></h2>
        </div>

        <section className="profile-form-surface bike-form">
          <FormSection title="Bike Data">
            <div className="bike-grid four">
              <TextField label="Bike Name" value={bikeSetup.bikeName} onChange={(value) => setBikeSetupField(setBikeSetup, "bikeName", value)} />
              <SelectField label="Bike Type" value={bikeSetup.bikeType} options={bikeTypeOptions} onChange={(value) => updateBikeSetup("bikeType", value)} />
              <NumberField label="Bike Weight" value={profile.bikeWeightKg} unit="kg" min={5} max={18} step={0.1} onChange={(value) => setProfileField(setProfile, "bikeWeightKg", value)} />
              <SelectField label="Components" value={bikeSetup.components} options={componentOptions} onChange={(value) => updateBikeSetup("components", value)} />
            </div>
          </FormSection>

          <FormSection title="Wheel & Tire Data">
            <div className="bike-grid four">
              <SelectField label="Front Wheel Type" value={bikeSetup.frontWheelType} options={frontWheelTypeOptions} onChange={(value) => updateBikeSetup("frontWheelType", value)} />
              <SelectField label="Front Wheel Width" value={bikeSetup.frontWheelWidth} options={wheelWidthOptions} onChange={(value) => updateBikeSetup("frontWheelWidth", value)} />
              <SelectField label="Rear Wheel Type" value={bikeSetup.rearWheelType} options={rearWheelTypeOptions} onChange={(value) => updateBikeSetup("rearWheelType", value)} />
              <SelectField label="Rear Wheel Width" value={bikeSetup.rearWheelWidth} options={wheelWidthOptions} onChange={(value) => updateBikeSetup("rearWheelWidth", value)} />
              <SelectField label="Tire Type" value={bikeSetup.tireType} options={tireTypeOptions} onChange={(value) => updateBikeSetup("tireType", value)} />
              <SelectField label="Tube Type (clincher only)" value={bikeSetup.tubeType} options={tubeTypeOptions} onChange={(value) => updateBikeSetup("tubeType", value)} />
            </div>
          </FormSection>

          <FormSection title="Riding Style">
            <div className="bike-grid three">
              <SelectField label="Racing Position" value={bikeSetup.racingPosition} options={racingPositionOptions} onChange={(value) => updateBikeSetup("racingPosition", value)} />
              <SelectField label="Climbing Position" value={bikeSetup.climbingPosition} options={climbingPositionOptions} onChange={(value) => updateBikeSetup("climbingPosition", value)} />
              <SelectField label="Helmet Type" value={bikeSetup.helmetType} options={helmetTypeOptions} onChange={(value) => updateBikeSetup("helmetType", value)} />
            </div>
          </FormSection>

          <FormSection title="Drag Calculations">
            <div className="drag-methods">
              <DragMethodButton title="Use Basic Riding Style" detail="Estimate drag from bike, wheel, tire, helmet, and position choices." value="basic" selected={activeDragMethod} onChange={(value) => updateBikeSetup("dragMethod", value)} />
              <DragMethodButton title="Use Bike Fit Measurements" detail="Use fit measurements and setup selection for a tighter estimate." value="fit" selected={activeDragMethod} onChange={(value) => updateBikeSetup("dragMethod", value)} />
              <DragMethodButton title="Use Manual Entry" detail="Enter zero-yaw and yaw-dependent CdA values manually." value="manual" selected={activeDragMethod} onChange={(value) => updateBikeSetup("dragMethod", value)} />
            </div>
          </FormSection>

          {activeDragMethod === "fit" && (
            <FormSection title="Bike Fit Measurements">
              <div className="bike-grid five">
                <TextField label="Shoulder Width" value={bikeSetup.shoulderWidth} onChange={(value) => setBikeSetupField(setBikeSetup, "shoulderWidth", value)} />
                <TextField label="Hip Width" value={bikeSetup.hipWidth} onChange={(value) => setBikeSetupField(setBikeSetup, "hipWidth", value)} />
                <TextField label="Hand Width (Racing)" value={bikeSetup.handleWidthRacing} onChange={(value) => setBikeSetupField(setBikeSetup, "handleWidthRacing", value)} />
                <TextField label="Hand Width (Climbing)" value={bikeSetup.handleWidthClimbing} onChange={(value) => setBikeSetupField(setBikeSetup, "handleWidthClimbing", value)} />
                <TextField label="Hip to Shoulder" value={bikeSetup.hipToShoulder} onChange={(value) => setBikeSetupField(setBikeSetup, "hipToShoulder", value)} />
                <TextField label="Hip to Head" value={bikeSetup.hipToHead} onChange={(value) => setBikeSetupField(setBikeSetup, "hipToHead", value)} />
                <TextField label="Seat to Handlebar Drop" value={bikeSetup.seatToHandlebarDrop} onChange={(value) => setBikeSetupField(setBikeSetup, "seatToHandlebarDrop", value)} />
                <TextField label="Torso Angle (Racing)" value={bikeSetup.torsoAngleRacing} onChange={(value) => setBikeSetupField(setBikeSetup, "torsoAngleRacing", value)} />
                <TextField label="Torso Angle (Climbing)" value={bikeSetup.torsoAngleClimbing} onChange={(value) => setBikeSetupField(setBikeSetup, "torsoAngleClimbing", value)} />
                <TextField label="Seat Tube Angle" value={bikeSetup.seatTubeAngle} onChange={(value) => setBikeSetupField(setBikeSetup, "seatTubeAngle", value)} />
              </div>
            </FormSection>
          )}

          <FormSection title="Calculated Values">
            <div className="calculated-bike-grid">
              <NumberField label="Rolling Resistance" value={profile.crr} unit="" min={0.002} max={0.012} step={0.00001} onChange={(value) => setProfileField(setProfile, "crr", value)} />
              <NumberField label="Mechanical Loss" value={profile.drivetrainLossPct / 100} unit="" min={0} max={0.08} step={0.001} onChange={(value) => setProfileField(setProfile, "drivetrainLossPct", value * 100)} />
              <CdaYawTable
                title="CdA Racing"
                values={bikeSetup.cdaRacingByYaw}
                onChange={(yaw, value) => {
                  setBikeCdaYaw(setBikeSetup, "cdaRacingByYaw", yaw, value);
                  setProfileCdaYaw(setProfile, "cdaRaceYaw", yaw, value);
                  if (yaw === "0") {
                    setProfileField(setProfile, "cdaRace", value);
                  }
                }}
              />
              <CdaYawTable
                title="CdA Climbing"
                values={bikeSetup.cdaClimbingByYaw}
                onChange={(yaw, value) => {
                  setBikeCdaYaw(setBikeSetup, "cdaClimbingByYaw", yaw, value);
                  setProfileCdaYaw(setProfile, "cdaClimbYaw", yaw, value);
                  if (yaw === "0") {
                    setProfileField(setProfile, "cdaClimb", value);
                  }
                }}
              />
            </div>
          </FormSection>

          <div className="button-row">
            <button className="button ghost recalc-button" type="button" onClick={() => applyCalculatedValues({ ...bikeSetup, dragMethod: "basic" })}>
              <RotateCcw size={17} />
              Recalculate from BBS Options
            </button>
          </div>

          <div className="save-status" aria-live="polite">
            <Save size={18} />
            Lokal gespeichert
          </div>

          <FormSection title="GPX-Auswertung">
            <CourseEvaluation
              route={route}
              result={result}
              hasPendingSimulation={hasPendingSimulation}
              onImportGpx={onImportGpx}
              onRunSimulation={onRunSimulation}
            />
            {importError && <p className="error-line">{importError}</p>}
          </FormSection>
        </section>
      </section>

      <AccountRail activeView={activeView} setActiveView={setActiveView} />
    </main>
  );
}

function RacePlansView({
  racePlans,
  route,
  result,
  onSaveCurrent,
  onOpenPlan,
  onDeletePlan,
  onImportGpx,
  activeView,
  setActiveView
}: {
  racePlans: RacePlan[];
  route: PreparedRoute | null;
  result: SimulationResult | null;
  onSaveCurrent: () => void;
  onOpenPlan: (id: string) => void;
  onDeletePlan: (id: string) => void;
  onImportGpx: () => void;
  activeView: ActiveView;
  setActiveView: Dispatch<SetStateAction<ActiveView>>;
}) {
  return (
    <main className="profile-workspace">
      <section className="profile-main">
        <div className="page-strip">
          <h2>Race Plans</h2>
        </div>

        <section className="profile-form-surface">
          <div className="race-plan-actions">
            <button className="button secondary" type="button" onClick={onSaveCurrent} disabled={!route || !result}>
              <Save size={17} />
              Aktuelle Prediction speichern
            </button>
            <button className="button ghost" type="button" onClick={onImportGpx}>
              <Upload size={17} />
              GPX laden
            </button>
          </div>

          {racePlans.length === 0 ? (
            <section className="empty-route-panel compact-panel">
              <Target size={32} />
              <h2>Keine Race Plans gespeichert</h2>
              <p>Lade eine GPX und speichere die aktuelle Prediction als Race Plan.</p>
            </section>
          ) : (
            <div className="race-plan-list">
              {racePlans.map((plan) => (
                <article className="race-plan-card" key={plan.id}>
                  <div>
                    <h3>{plan.name}</h3>
                    <p>{plan.courseName} · {formatDateTime(plan.createdAt)}</p>
                  </div>
                  <div className="race-plan-card-stats">
                    <Stat label="Time" value={formatTime(plan.totalTimeSec)} />
                    <Stat label="Speed" value={formatSpeed(plan.averageSpeedMps)} />
                    <Stat label="Power" value={formatWatts(plan.solvedPowerW ?? plan.averagePowerW)} />
                    <Stat label="NP" value={formatWatts(getRacePlanNormalizedPower(plan))} />
                  </div>
                  <div className="race-plan-card-actions">
                    <button className="button secondary" type="button" onClick={() => onOpenPlan(plan.id)}>Details</button>
                    <button className="button ghost" type="button" onClick={() => onDeletePlan(plan.id)}>Delete</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>

      <AccountRail activeView={activeView} setActiveView={setActiveView} />
    </main>
  );
}

function RaceDetailsView({
  racePlan,
  onBack,
  onDeletePlan,
  activeView,
  setActiveView
}: {
  racePlan: RacePlan | null;
  onBack: () => void;
  onDeletePlan: (id: string) => void;
  activeView: ActiveView;
  setActiveView: Dispatch<SetStateAction<ActiveView>>;
}) {
  const [chartAxis, setChartAxis] = useState<ChartAxis>("distance");
  const [markerDistanceM, setMarkerDistanceM] = useState(0);

  useEffect(() => {
    setMarkerDistanceM(0);
  }, [racePlan?.id]);

  if (!racePlan) {
    return (
      <main className="profile-workspace">
        <section className="profile-main">
          <div className="page-strip">
            <h2>Race Plan Details</h2>
          </div>
          <section className="profile-form-surface">
            <section className="empty-route-panel compact-panel">
              <Target size={32} />
              <h2>Kein Race Plan ausgewählt</h2>
              <button className="button secondary" type="button" onClick={onBack}>Zur Liste</button>
            </section>
          </section>
        </section>
        <AccountRail activeView={activeView} setActiveView={setActiveView} />
      </main>
    );
  }

  return (
    <main className="profile-workspace">
      <section className="profile-main">
        <div className="page-strip detail-strip">
          <h2>{racePlan.name}</h2>
          <div className="detail-strip-actions">
            <button className="button ghost" type="button" onClick={onBack}>Back</button>
            <button className="button ghost" type="button" onClick={() => onDeletePlan(racePlan.id)}>Delete</button>
          </div>
        </div>

        <section className="race-analysis-surface">
          <div className="analysis-tabs">
            {["Power Plan", "Time Analysis", "Weather", "Zones", "Yaw Angles", "Gradients", "Peak Power", "Surfaces", "Notes"].map((tab, index) => (
              <button className={index === 0 ? "active" : ""} type="button" key={tab}>{tab}</button>
            ))}
          </div>

          <section className="bbs-analysis-panel">
            <div className="analysis-toggle">
              <button className={chartAxis === "distance" ? "active" : ""} type="button" onClick={() => setChartAxis("distance")}>Distance</button>
              <button className={chartAxis === "time" ? "active" : ""} type="button" onClick={() => setChartAxis("time")}>Time</button>
            </div>
            <p className="drag-help">click and drag on the data to view that section's summary metrics</p>
            <RaceAnalysisChart
              racePlan={racePlan}
              axis={chartAxis}
              markerDistanceM={markerDistanceM}
              onMarkerChange={setMarkerDistanceM}
            />
          </section>

          <RouteMap racePlan={racePlan} markerDistanceM={markerDistanceM} wide />

          <details className="race-accordion">
            <summary>Race Summary</summary>
            <div className="race-summary-grid">
              <Stat label="Bike Split" value={formatTime(racePlan.totalTimeSec)} />
              <Stat label="Distance" value={formatDistance(racePlan.distanceM)} />
              <Stat label="Avg Speed" value={formatSpeed(racePlan.averageSpeedMps)} />
              <Stat label="Avg Power" value={formatWatts(racePlan.solvedPowerW ?? racePlan.averagePowerW)} />
              <Stat label="NP" value={formatWatts(getRacePlanNormalizedPower(racePlan))} />
              <Stat label="CdA Scale" value={`${(racePlan.cdaScale * 100).toFixed(1)}%`} />
              <Stat label="Bike" value={racePlan.bikeName} />
            </div>
          </details>

          <details className="race-accordion">
            <summary>Race Intervals</summary>
            <SavedSegmentTable racePlan={racePlan} />
          </details>

          <details className="race-accordion">
            <summary>Category Climbs <span>NEW</span></summary>
            <ClimbTable racePlan={racePlan} />
          </details>
        </section>
      </section>

      <AccountRail activeView={activeView} setActiveView={setActiveView} />
    </main>
  );
}

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="form-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function AccountRail({
  activeView,
  setActiveView
}: {
  activeView: ActiveView;
  setActiveView: Dispatch<SetStateAction<ActiveView>>;
}) {
  const items = [
    { label: "Dashboard", icon: <LayoutDashboard size={16} />, view: "simulator" as ActiveView },
    { label: "Profile", icon: <User size={16} />, view: "profile" as ActiveView },
    { label: "Bikes", icon: <Bike size={16} />, view: "bike" as ActiveView },
    { label: "Courses", icon: <Map size={16} />, view: "courses" as ActiveView },
    { label: "Race Plans", icon: <Target size={16} />, view: "racePlans" as ActiveView }
  ];

  return (
    <aside className="account-rail">
      <div className="rail-menu">
        {items.map((item) => (
          <button
            key={item.label}
            className={activeView === item.view ? "active" : ""}
            type="button"
            onClick={() => setActiveView(item.view)}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>
    </aside>
  );
}

function TextField({
  label,
  value,
  onChange
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <input type="text" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
  compact = false
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  return (
    <label className={`form-field ${compact ? "compact" : ""}`}>
      {label && <span>{label}</span>}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function ChoiceGroup({
  label,
  options,
  value,
  onChange
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="choice-field">
      <span>{label}</span>
      <div className="choice-group">
        {options.map((option) => (
          <button key={option.value} type="button" className={value === option.value ? "active" : ""} onClick={() => onChange(option.value)}>
            {value === option.value && <Check size={15} />}
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function DragMethodButton({
  title,
  detail,
  value,
  selected,
  onChange
}: {
  title: string;
  detail: string;
  value: DragMethod;
  selected: DragMethod;
  onChange: (value: DragMethod) => void;
}) {
  return (
    <button className={`drag-method ${selected === value ? "active" : ""}`} type="button" onClick={() => onChange(value)}>
      <span className="radio-dot" />
      <strong>{title}</strong>
      <em>{detail}</em>
    </button>
  );
}

function CdaYawTable({
  title,
  values,
  onChange
}: {
  title: string;
  values: Record<string, number>;
  onChange: (yaw: string, value: number) => void;
}) {
  const yawAngles = ["0", "5", "10", "15", "20"];

  return (
    <div className="cda-table">
      <h4>{title}</h4>
      <div className="cda-header">
        <span>Yaw Angle</span>
        <span>CdA</span>
      </div>
      {yawAngles.map((yaw) => (
        <label className="cda-row" key={yaw}>
          <span>{yaw} deg</span>
          <EditableNumberInput value={values[yaw] ?? 0} min={0.18} max={0.6} step={0.0001} onChange={(value) => onChange(yaw, value)} />
        </label>
      ))}
    </div>
  );
}

function NumberField({
  label,
  help,
  value,
  unit,
  min,
  max,
  step,
  onChange
}: {
  label: string;
  help?: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="number-field">
      <span className="field-label-row">
        <span className="field-label-text">
          {label}
          {help && <HelpTip text={help} />}
        </span>
      </span>
      <div className="input-wrap">
        <EditableNumberInput value={value} min={min} max={max} step={step} onChange={onChange} />
        {unit && <em>{unit}</em>}
      </div>
    </label>
  );
}

function EditableNumberInput({
  value,
  min,
  max,
  step,
  onChange
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(() => formatInputValue(value, step));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setDraft(formatInputValue(value, step));
    }
  }, [isFocused, step, value]);

  const commitDraft = () => {
    const parsed = parseNumberDraft(draft);
    const nextValue = parsed == null ? value : clampNumber(parsed, min, max);
    onChange(nextValue);
    setDraft(formatInputValue(nextValue, step));
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      role="spinbutton"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Number.isFinite(value) ? value : undefined}
      value={draft}
      onFocus={(event) => {
        setIsFocused(true);
        window.setTimeout(() => event.currentTarget.select(), 0);
      }}
      onChange={(event) => {
        const nextDraft = event.target.value;
        setDraft(nextDraft);
        const parsed = parseNumberDraft(nextDraft);
        if (parsed != null) {
          onChange(parsed);
        }
      }}
      onBlur={() => {
        commitDraft();
        setIsFocused(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          commitDraft();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          setDraft(formatInputValue(value, step));
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function RangeField({
  label,
  help,
  value,
  min,
  max,
  step,
  unit,
  onChange
}: {
  label: string;
  help?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="range-field">
      <span className="field-label-row">
        <span className="field-label-text">
          {label}
          {help && <HelpTip text={help} />}
        </span>
        <strong>
          {value.toFixed(step < 1 ? 2 : 0)} {unit}
        </strong>
      </span>
      <input type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function HelpTip({ text, focusable = true }: { text: string; focusable?: boolean }) {
  return (
    <span className="help-tip" tabIndex={focusable ? 0 : undefined} aria-label={text}>
      <CircleHelp size={13} strokeWidth={2.2} />
      <span className="help-tooltip" role="tooltip">
        {text}
      </span>
    </span>
  );
}

const ElevationChart = memo(function ElevationChart({ route }: { route: PreparedRoute }) {
  const points = downsample(route.points, 280);
  const values = points.map((point) => point.ele);
  const path = createLinePath(values, 720, 190, 20);
  const area = `${path} L 720 190 L 0 190 Z`;

  return (
    <div className="chart elevation-chart">
      <svg viewBox="0 0 720 210" role="img" aria-label="Hoehenprofil">
        <path d={area} className="elevation-area" />
        <path d={path} className="elevation-line" />
        <GridLines width={720} height={190} />
      </svg>
    </div>
  );
});

const PowerChart = memo(function PowerChart({ result, ftpW }: { result: SimulationResult; ftpW: number }) {
  const chartSegments = useMemo(() => downsample(result.segments, 520), [result.segments]);
  const values = chartSegments.map((segment) => segment.powerW);
  const max = Math.max(ftpW, ...values) * 1.08;
  const bars = chartSegments.map((segment, index) => {
    const width = 720 / chartSegments.length;
    const height = Math.max(2, (segment.powerW / max) * 170);
    const x = index * width;
    const y = 185 - height;
    const intensity = segment.powerW / ftpW;
    const className = intensity > 0.9 ? "hot" : intensity > 0.75 ? "warm" : "cool";
    return <rect key={segment.index} x={x} y={y} width={Math.max(1, width - 1)} height={height} className={className} rx="1" />;
  });

  return (
    <div className="chart power-chart">
      <svg viewBox="0 0 720 210" role="img" aria-label="Leistungsprofil">
        <GridLines width={720} height={185} />
        {bars}
      </svg>
    </div>
  );
});

function SavedPowerChart({ segments, ftpW }: { segments: RacePlan["segments"]; ftpW: number }) {
  const result = {
    segments
  } as SimulationResult;
  return <PowerChart result={result} ftpW={ftpW} />;
}

const RaceAnalysisChart = memo(function RaceAnalysisChart({
  racePlan,
  axis,
  markerDistanceM,
  onMarkerChange
}: {
  racePlan: RacePlan;
  axis: ChartAxis;
  markerDistanceM: number;
  onMarkerChange: (distanceM: number) => void;
}) {
  const width = 1200;
  const height = 230;
  const paddingX = 18;
  const chartBottom = 205;
  const chartSegments = useMemo(() => downsample(racePlan.segments, 900), [racePlan.segments]);
  const cumulativeTimes = useMemo(() => buildCumulativeSegmentTimes(racePlan.segments), [racePlan.segments]);
  const maxPower = useMemo(() => Math.max(320, ...chartSegments.map((segment) => segment.powerW)) * 1.12, [chartSegments]);
  const maxSpeed = useMemo(
    () => Math.max(45, ...chartSegments.map((segment) => segment.speedMps * 3.6)) * 1.12,
    [chartSegments]
  );
  const elevations = useMemo(
    () =>
      racePlan.points?.length
        ? downsample(racePlan.points, 360).map((point) => point.ele)
        : racePlan.segments.map((segment) => segment.grade * 1000),
    [racePlan.points, racePlan.segments]
  );
  const elevationStats = useMemo(() => {
    const minEle = Math.min(...elevations);
    const maxEle = Math.max(...elevations);
    return { minEle, eleSpan: Math.max(1, maxEle - minEle) };
  }, [elevations]);

  const xForDistance = useCallback((distanceM: number) => {
    const ratio = axis === "time"
      ? elapsedTimeAtDistance(racePlan, distanceM, cumulativeTimes) / Math.max(1, racePlan.totalTimeSec)
      : distanceM / Math.max(1, racePlan.distanceM);
    return paddingX + clampNumber(ratio, 0, 1) * (width - paddingX * 2);
  }, [axis, cumulativeTimes, racePlan]);
  const markerX = xForDistance(markerDistanceM);
  const markerSegment = segmentAtDistance(racePlan, markerDistanceM);
  const markerElapsedSec = useMemo(
    () => elapsedTimeAtDistance(racePlan, markerDistanceM, cumulativeTimes),
    [cumulativeTimes, markerDistanceM, racePlan]
  );

  const handlePointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = clampNumber((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    const distanceM = axis === "time"
      ? distanceAtElapsedTime(racePlan, ratio * racePlan.totalTimeSec, cumulativeTimes)
      : ratio * racePlan.distanceM;
    onMarkerChange(distanceM);
  };

  const powerArea = useMemo(
    () =>
      chartSegments
        .map((segment, index) => {
          const x = xForDistance(segment.endDistanceM);
          const y = chartBottom - (segment.powerW / maxPower) * 170;
          return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
        })
        .join(" "),
    [chartSegments, maxPower, xForDistance]
  );
  const speedPath = useMemo(
    () =>
      chartSegments
        .map((segment, index) => {
          const x = xForDistance(segment.endDistanceM);
          const y = chartBottom - ((segment.speedMps * 3.6) / maxSpeed) * 170;
          return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
        })
        .join(" "),
    [chartSegments, maxSpeed, xForDistance]
  );
  const elevationPath = useMemo(
    () =>
      elevations
        .map((ele, index) => {
          const x = paddingX + (index / Math.max(1, elevations.length - 1)) * (width - paddingX * 2);
          const y = chartBottom - ((ele - elevationStats.minEle) / elevationStats.eleSpan) * 145;
          return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
        })
        .join(" "),
    [elevationStats, elevations]
  );

  return (
    <div className="race-analysis-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Race analysis chart"
        onPointerDown={handlePointer}
        onPointerMove={(event) => {
          if (event.buttons === 1) {
            handlePointer(event);
          }
        }}
      >
        <GridLines width={width} height={chartBottom} />
        <path d={`${powerArea} L ${width - paddingX} ${chartBottom} L ${paddingX} ${chartBottom} Z`} className="race-power-area" />
        <path d={speedPath} className="race-speed-line" />
        <path d={elevationPath} className="race-elevation-line" />
        <line className="race-marker-line" x1={markerX} x2={markerX} y1="20" y2={chartBottom} />
        <circle className="race-marker-dot" cx={markerX} cy="28" r="5" />
      </svg>
      <div className="marker-summary">
        <span>{axis === "time" ? formatTime(markerElapsedSec) : formatDistance(markerDistanceM)}</span>
        <span>{formatWatts(markerSegment.powerW)}</span>
        <span>{formatSpeed(markerSegment.speedMps)}</span>
      </div>
      <div className="chart-legend">
        <span className="power">Power</span>
        <span className="speed">Speed</span>
        <span className="elevation">Elevation</span>
      </div>
    </div>
  );
});

const RouteMap = memo(function RouteMap({
  route,
  course,
  racePlan,
  markerDistanceM,
  compact = false,
  wide = false
}: {
  route?: PreparedRoute;
  course?: SavedCourse;
  racePlan?: RacePlan;
  markerDistanceM?: number;
  compact?: boolean;
  wide?: boolean;
}) {
  const [zoomOffset, setZoomOffset] = useState(0);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const [mapSize, setMapSize] = useState({ width: 900, height: wide ? 320 : compact ? 160 : 360 });
  const points = route?.points ?? course?.points ?? racePlan?.points ?? [];
  const cumulativePoints = useMemo(() => computeCumulativeDistance(points), [points]);
  const mapKey = route?.name ?? course?.id ?? racePlan?.id ?? "empty";
  const mapData = useMemo(
    () => buildRouteMapData(points, zoomOffset, panOffset, mapSize),
    [mapSize, panOffset, points, zoomOffset]
  );
  const mapMarker = useMemo(
    () => (mapData && markerDistanceM != null ? buildRouteMarker(cumulativePoints, markerDistanceM, mapData) : null),
    [cumulativePoints, mapData, markerDistanceM]
  );

  useEffect(() => {
    setZoomOffset(0);
    setPanOffset({ x: 0, y: 0 });
  }, [mapKey]);

  useEffect(() => {
    const element = mapRef.current;
    if (!element) {
      return;
    }

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      const nextSize = {
        width: Math.max(320, Math.round(rect.width)),
        height: Math.max(140, Math.round(rect.height))
      };
      setMapSize((current) =>
        current.width === nextSize.width && current.height === nextSize.height ? current : nextSize
      );
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  if (!mapData) {
    return null;
  }

  const resetMapView = () => {
    setZoomOffset(0);
    setPanOffset({ x: 0, y: 0 });
  };

  const zoomIn = () => {
    setZoomOffset((current) => Math.min(4, current + 1));
    setPanOffset((current) => ({ x: current.x * 2, y: current.y * 2 }));
  };

  const zoomOut = () => {
    setZoomOffset((current) => Math.max(0, current - 1));
    setPanOffset((current) => ({ x: current.x / 2, y: current.y / 2 }));
  };

  const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest(".map-controls")) {
      return;
    }

    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      panX: panOffset.x,
      panY: panOffset.y
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) {
      return;
    }

    const deltaX = event.clientX - dragRef.current.startX;
    const deltaY = event.clientY - dragRef.current.startY;
    setPanOffset({
      x: dragRef.current.panX - deltaX,
      y: dragRef.current.panY - deltaY
    });
  };

  const endPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      ref={mapRef}
      className={`route-map ${compact ? "compact" : ""} ${wide ? "wide" : ""}`}
      onPointerDown={startPan}
      onPointerMove={movePan}
      onPointerUp={endPan}
      onPointerCancel={endPan}
    >
      <div className="map-controls">
        <button type="button" onClick={zoomIn}>+</button>
        <button type="button" onClick={zoomOut}>-</button>
        <button className="fit-button" type="button" onClick={resetMapView}>Fit</button>
      </div>
      <div className="osm-tiles">
        {mapData.tiles.map((tile) => (
          <img
            key={`${tile.x}-${tile.y}`}
            src={`https://tile.openstreetmap.org/${mapData.zoom}/${tile.urlX}/${tile.y}.png`}
            style={{
              left: `${tile.left}px`,
              top: `${tile.top}px`,
              width: `${tile.size}px`,
              height: `${tile.size}px`
            }}
            alt=""
            draggable={false}
            loading="lazy"
          />
        ))}
      </div>
      <svg viewBox={`0 0 ${mapData.width} ${mapData.height}`} preserveAspectRatio="none" aria-label="OpenStreetMap route overlay">
        <polyline points={mapData.polyline} />
        {mapMarker && <circle className="route-marker" cx={mapMarker.x} cy={mapMarker.y} r="7" />}
      </svg>
    </div>
  );
});

function GridLines({ width, height }: { width: number; height: number }) {
  return (
    <g className="grid-lines">
      {[0.25, 0.5, 0.75].map((ratio) => (
        <line key={ratio} x1="0" x2={width} y1={height * ratio} y2={height * ratio} />
      ))}
    </g>
  );
}

const SegmentTable = memo(function SegmentTable({ result, ftpW }: { result: SimulationResult; ftpW: number }) {
  const visibleSegments = result.segments.slice(0, 400);
  return (
    <>
      {result.segments.length > visibleSegments.length && (
        <p className="table-note">Showing first {visibleSegments.length} of {result.segments.length} segments.</p>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>km</th>
              <th>Grad</th>
              <th>W</th>
              <th>% FTP</th>
              <th>Speed</th>
              <th>Zeit</th>
              <th>Yaw</th>
              <th>Wind</th>
              <th>Pos.</th>
            </tr>
          </thead>
          <tbody>
            {visibleSegments.map((segment) => (
              <tr key={segment.index}>
                <td>{Math.round(segment.endDistanceM / 1000)}</td>
                <td>{formatPercent(segment.grade)}</td>
                <td>{formatWatts(segment.powerW)}</td>
                <td>{formatPercent(segment.powerW / ftpW)}</td>
                <td>{formatSpeed(segment.speedMps)}</td>
                <td>{formatTime(segment.timeSec)}</td>
                <td>{segment.yawDeg.toFixed(0)} deg</td>
                <td>{(segment.headwindMps * 3.6).toFixed(0)} km/h</td>
                <td>{segment.position === "race" ? "Aero" : "Climb"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
});

const SavedSegmentTable = memo(function SavedSegmentTable({ racePlan }: { racePlan: RacePlan }) {
  const visibleSegments = racePlan.segments.slice(0, 400);
  return (
    <>
      {racePlan.segments.length > visibleSegments.length && (
        <p className="table-note">Showing first {visibleSegments.length} of {racePlan.segments.length} segments.</p>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>km</th>
              <th>Grad</th>
              <th>W</th>
              <th>% FTP</th>
              <th>Speed</th>
              <th>Zeit</th>
              <th>Yaw</th>
              <th>Wind</th>
              <th>Pos.</th>
            </tr>
          </thead>
          <tbody>
            {visibleSegments.map((segment) => (
              <tr key={segment.index}>
                <td>{(segment.endDistanceM / 1000).toFixed(1)}</td>
                <td>{formatPercent(segment.grade)}</td>
                <td>{formatWatts(segment.powerW)}</td>
                <td>{Math.round((segment.powerW / racePlan.ftpW) * 100)}%</td>
                <td>{formatSpeed(segment.speedMps)}</td>
                <td>{formatTime(segment.timeSec)}</td>
                <td>{segment.yawDeg.toFixed(0)} deg</td>
                <td>{(segment.headwindMps * 3.6).toFixed(1)} km/h</td>
                <td>{segment.position}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
});

const ClimbTable = memo(function ClimbTable({ racePlan }: { racePlan: RacePlan }) {
  const climbs = racePlan.segments.filter((segment) => segment.grade > 0.015);
  if (climbs.length === 0) {
    return <p className="muted-line">No categorized climbs detected.</p>;
  }
  const visibleClimbs = climbs.slice(0, 400);

  return (
    <>
      {climbs.length > visibleClimbs.length && (
        <p className="table-note">Showing first {visibleClimbs.length} of {climbs.length} climbs.</p>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>km</th>
              <th>Length</th>
              <th>Grade</th>
              <th>Power</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {visibleClimbs.map((segment) => (
              <tr key={segment.index}>
                <td>{(segment.startDistanceM / 1000).toFixed(1)}</td>
                <td>{formatDistance(segment.distanceM)}</td>
                <td>{formatPercent(segment.grade)}</td>
                <td>{formatWatts(segment.powerW)}</td>
                <td>{formatTime(segment.timeSec)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
});

function createLinePath(values: number[], width: number, height: number, padding: number) {
  if (values.length === 0) {
    return "";
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  return values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * width;
      const y = padding + (1 - (value - min) / span) * (height - padding * 1.5);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function downsample<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) {
    return items;
  }

  const step = items.length / limit;
  const sample: T[] = [];
  for (let index = 0; index < limit; index += 1) {
    sample.push(items[Math.floor(index * step)]);
  }
  return sample;
}

function createRacePlanSnapshot({
  route,
  result,
  profile,
  baseProfile,
  bikeSetup,
  weather,
  mode,
  riderCdaScale
}: {
  route: PreparedRoute;
  result: SimulationResult;
  profile: RiderBikeProfile;
  baseProfile: RiderBikeProfile;
  bikeSetup: BikeSetupProfile;
  weather: WeatherProfile;
  mode: SimulationMode;
  riderCdaScale: number;
}): RacePlan {
  const createdAt = new Date().toISOString();
  return {
    id: `race-${Date.now()}`,
    name: `${route.name} ${new Date(createdAt).toLocaleDateString("de-DE")}`,
    courseName: route.name,
    bikeName: bikeSetup.bikeName || "Bike",
    createdAt,
    mode,
    distanceM: route.totalDistanceM,
    ascentM: route.totalAscentM,
    descentM: route.totalDescentM,
    totalTimeSec: result.summary.totalTimeSec,
    averageSpeedMps: result.summary.averageSpeedMps,
    averagePowerW: result.summary.averagePowerW,
    normalizedPowerW: result.summary.normalizedPowerW,
    solvedPowerW: result.solvedPowerW,
    riderWeightKg: baseProfile.riderWeightKg,
    bikeWeightKg: baseProfile.bikeWeightKg,
    ftpW: baseProfile.ftpW,
    cdaRace: profile.cdaRace,
    cdaClimb: profile.cdaClimb,
    crr: baseProfile.crr,
    drivetrainLossPct: baseProfile.drivetrainLossPct,
    cdaScale: riderCdaScale,
    weather,
    points: route.points.map((point) => ({
      lat: point.lat,
      lon: point.lon,
      ele: point.ele,
      time: point.time
    })),
    segments: result.segments.map((segment) => ({
      index: segment.index,
      startDistanceM: segment.startDistanceM,
      endDistanceM: segment.endDistanceM,
      distanceM: segment.distanceM,
      grade: segment.grade,
      powerW: segment.powerW,
      timeSec: segment.timeSec,
      speedMps: segment.speedMps,
      cda: segment.cda,
      yawDeg: segment.yawDeg,
      headwindMps: segment.headwindMps,
      position: segment.position
    }))
  };
}

function getRacePlanNormalizedPower(racePlan: RacePlan): number {
  const legacyPlan = racePlan as RacePlan & { weightedIntensity?: number };
  return racePlan.normalizedPowerW ?? legacyPlan.weightedIntensity ?? racePlan.averagePowerW;
}

function createSavedCourse(route: PreparedRoute): SavedCourse {
  return {
    id: `course-${Date.now()}`,
    name: route.name,
    createdAt: new Date().toISOString(),
    totalDistanceM: route.totalDistanceM,
    totalAscentM: route.totalAscentM,
    totalDescentM: route.totalDescentM,
    points: route.points.map((point) => ({
      lat: point.lat,
      lon: point.lon,
      ele: point.ele,
      time: point.time
    }))
  };
}

function buildRouteMapData(
  points: RawRoutePoint[],
  zoomOffset = 0,
  panOffset: { x: number; y: number } = { x: 0, y: 0 },
  viewport: { width: number; height: number } = { width: 900, height: 320 }
) {
  if (points.length < 2) {
    return null;
  }

  const tileSize = 256;
  const width = Math.max(320, viewport.width);
  const height = Math.max(140, viewport.height);
  const sample = downsample(points, 500);
  const lats = sample.map((point) => point.lat);
  const lons = sample.map((point) => point.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const centerLat = (minLat + maxLat) / 2;
  const centerLon = (minLon + maxLon) / 2;
  const baseZoom = chooseFittingMapZoom(minLon, maxLon, minLat, maxLat, width, height);
  const zoom = Math.min(17, baseZoom + zoomOffset);
  const baseCenter = lonLatToWorldPixel(centerLon, centerLat, zoom, tileSize);
  const center = {
    x: baseCenter.x + panOffset.x,
    y: baseCenter.y + panOffset.y
  };
  const worldLeft = center.x - width / 2;
  const worldTop = center.y - height / 2;
  const minTileX = Math.floor(worldLeft / tileSize) - 1;
  const maxTileX = Math.ceil((worldLeft + width) / tileSize) + 1;
  const minTileY = Math.max(0, Math.floor(worldTop / tileSize) - 1);
  const maxTileY = Math.min(2 ** zoom - 1, Math.ceil((worldTop + height) / tileSize) + 1);
  const maxTile = 2 ** zoom;
  const tiles: Array<{ x: number; y: number; urlX: number; left: number; top: number; size: number }> = [];

  for (let y = minTileY; y <= maxTileY; y += 1) {
    for (let x = minTileX; x <= maxTileX; x += 1) {
      tiles.push({
        x,
        y,
        urlX: ((x % maxTile) + maxTile) % maxTile,
        left: x * tileSize - worldLeft - 1,
        top: y * tileSize - worldTop - 1,
        size: tileSize + 2
      });
    }
  }

  const projected = sample.map((point) => {
    const pixel = lonLatToWorldPixel(point.lon, point.lat, zoom, tileSize);
    return {
      x: pixel.x - worldLeft,
      y: pixel.y - worldTop
    };
  });

  return {
    width,
    height,
    zoom,
    tileSize,
    worldLeft,
    worldTop,
    tiles,
    polyline: projected.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ")
  };
}

function buildRouteMarker(
  points: RoutePoint[],
  markerDistanceM: number,
  mapData: NonNullable<ReturnType<typeof buildRouteMapData>>
) {
  const markerPoint = interpolateAtDistance(points, markerDistanceM);
  const markerPixel = lonLatToWorldPixel(markerPoint.lon, markerPoint.lat, mapData.zoom, mapData.tileSize);
  return {
    x: markerPixel.x - mapData.worldLeft,
    y: markerPixel.y - mapData.worldTop
  };
}

function chooseFittingMapZoom(
  minLon: number,
  maxLon: number,
  minLat: number,
  maxLat: number,
  width: number,
  height: number
): number {
  const padding = 0.84;
  for (let zoom = 17; zoom >= 3; zoom -= 1) {
    const nw = lonLatToWorldPixel(minLon, maxLat, zoom);
    const se = lonLatToWorldPixel(maxLon, minLat, zoom);
    if (Math.abs(se.x - nw.x) <= width * padding && Math.abs(se.y - nw.y) <= height * padding) {
      return zoom;
    }
  }
  return 3;
}

function lonLatToWorldPixel(lon: number, lat: number, zoom: number, tileSize = 256) {
  const scale = 2 ** zoom;
  const latRad = (lat * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * scale * tileSize,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale * tileSize
  };
}

function distanceAtElapsedTime(
  racePlan: RacePlan,
  elapsedSec: number,
  cumulativeTimes = buildCumulativeSegmentTimes(racePlan.segments)
): number {
  let low = 0;
  let high = racePlan.segments.length - 1;
  const clampedElapsedSec = clampNumber(elapsedSec, 0, cumulativeTimes.at(-1) ?? racePlan.totalTimeSec);

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (cumulativeTimes[mid] < clampedElapsedSec) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  const segment = racePlan.segments[low] ?? racePlan.segments.at(-1)!;
  const elapsedBeforeLow = low > 0 ? cumulativeTimes[low - 1] : 0;
  const ratio = clampNumber((clampedElapsedSec - elapsedBeforeLow) / Math.max(1, segment.timeSec), 0, 1);
  return segment.startDistanceM + ratio * segment.distanceM;
}

function elapsedTimeAtDistance(
  racePlan: RacePlan,
  distanceM: number,
  cumulativeTimes = buildCumulativeSegmentTimes(racePlan.segments)
): number {
  const index = segmentIndexAtDistance(racePlan, distanceM);
  const segment = racePlan.segments[index] ?? racePlan.segments.at(-1)!;
  const elapsedBefore = index > 0 ? cumulativeTimes[index - 1] : 0;
  const ratio = clampNumber((distanceM - segment.startDistanceM) / Math.max(1, segment.distanceM), 0, 1);
  return elapsedBefore + ratio * segment.timeSec;
}

function segmentAtDistance(racePlan: RacePlan, distanceM: number): RacePlan["segments"][number] {
  return racePlan.segments[segmentIndexAtDistance(racePlan, distanceM)] ?? racePlan.segments.at(-1)!;
}

function segmentIndexAtDistance(racePlan: RacePlan, distanceM: number): number {
  let low = 0;
  let high = racePlan.segments.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (racePlan.segments[mid].endDistanceM < distanceM) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function buildCumulativeSegmentTimes(segments: RacePlan["segments"]): number[] {
  let elapsed = 0;
  return segments.map((segment) => {
    elapsed += segment.timeSec;
    return elapsed;
  });
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function deriveBbsBikeCalculatedValues(setup: BikeSetupProfile): BbsBikeCalculatedValues {
  return calculateBbsBikeValues(setup);
}

function calculateSuggestedRiderCdaScale(athleteProfile: AthleteProfile, riderWeightKg: number): number {
  const heightM = clampNumber(athleteProfile.heightCm / 100, 1.2, 2.3);
  const massKg = clampNumber(riderWeightKg, 45, 130);
  const reference = { heightM: 1.8, massKg: 74 };
  return Math.pow(heightM / reference.heightM, 1.1) * Math.pow(massKg / reference.massKg, 0.45);
}

function calculateRiderCdaScale(athleteProfile: AthleteProfile, suggestedScale: number): number {
  if (athleteProfile.scaleCdaByRiderSize === false) {
    return 1;
  }

  const scalePct =
    athleteProfile.cdaScalePct != null && Number.isFinite(athleteProfile.cdaScalePct)
      ? athleteProfile.cdaScalePct
      : suggestedScale * 100;
  return clampNumber(scalePct, 70, 140) / 100;
}

function scaleCdaMap(values: Record<string, number>, scale: number): Record<string, number> {
  return Object.fromEntries(
    Object.entries(values).map(([yaw, cda]) => [yaw, scaleSystemCdaByRider(cda, scale)])
  );
}

function applyRiderCdaScaleToProfile(profile: RiderBikeProfile, scale: number): RiderBikeProfile {
  if (scale === 1) {
    return profile;
  }

  return {
    ...profile,
    cdaRace: scaleSystemCdaByRider(profile.cdaRace, scale),
    cdaClimb: scaleSystemCdaByRider(profile.cdaClimb, scale),
    cdaRaceYaw: scaleCdaMap(profile.cdaRaceYaw, scale),
    cdaClimbYaw: scaleCdaMap(profile.cdaClimbYaw, scale)
  };
}

function scaleSystemCdaByRider(cda: number, riderScale: number): number {
  const equipmentCda = Math.min(EQUIPMENT_CDA_M2, cda);
  return round4(equipmentCda + (cda - equipmentCda) * riderScale);
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function applyBbsCalculatedToProfile(
  setProfile: Dispatch<SetStateAction<RiderBikeProfile>>,
  calculated: BbsBikeCalculatedValues
) {
  setProfile((current) => ({
    ...current,
    crr: calculated.rollingResistance,
    drivetrainLossPct: calculated.mechanicalLoss * 100,
    cdaRace: calculated.cdaRacingByYaw["0"],
    cdaClimb: calculated.cdaClimbingByYaw["0"],
    cdaRaceYaw: calculated.cdaRacingByYaw,
    cdaClimbYaw: calculated.cdaClimbingByYaw
  }));
}

function setProfileField(
  setProfile: Dispatch<SetStateAction<RiderBikeProfile>>,
  key: keyof RiderBikeProfile,
  value: number
) {
  setProfile((current) => ({ ...current, [key]: value }));
}

function setAthleteField<K extends keyof AthleteProfile>(
  setAthleteProfile: Dispatch<SetStateAction<AthleteProfile>>,
  key: K,
  value: AthleteProfile[K]
) {
  setAthleteProfile((current) => ({ ...current, [key]: value }));
}

function setBikeSetupField<K extends keyof BikeSetupProfile>(
  setBikeSetup: Dispatch<SetStateAction<BikeSetupProfile>>,
  key: K,
  value: BikeSetupProfile[K]
) {
  setBikeSetup((current) => ({ ...current, [key]: value }));
}

function setBikeCdaYaw(
  setBikeSetup: Dispatch<SetStateAction<BikeSetupProfile>>,
  key: "cdaRacingByYaw" | "cdaClimbingByYaw",
  yaw: string,
  value: number
) {
  setBikeSetup((current) => ({
    ...current,
    [key]: {
      ...current[key],
      [yaw]: value
    }
  }));
}

function setProfileCdaYaw(
  setProfile: Dispatch<SetStateAction<RiderBikeProfile>>,
  key: "cdaRaceYaw" | "cdaClimbYaw",
  yaw: string,
  value: number
) {
  setProfile((current) => ({
    ...current,
    [key]: {
      ...current[key],
      [yaw]: value
    }
  }));
}

function setWeatherField(
  setWeather: Dispatch<SetStateAction<WeatherProfile>>,
  key: keyof WeatherProfile,
  value: number
) {
  setWeather((current) => ({ ...current, [key]: value }));
}

function useStoredState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        return initial;
      }
      const parsed = JSON.parse(raw) as T;
      return isRecord(initial) && isRecord(parsed) ? ({ ...initial, ...parsed } as T) : parsed;
    } catch {
      return initial;
    }
  });

  const setStoredValue: Dispatch<SetStateAction<T>> = (next) => {
    setValue((current) => {
      const resolved = typeof next === "function" ? (next as (value: T) => T)(current) : next;
      window.localStorage.setItem(key, JSON.stringify(resolved));
      return resolved;
    });
  };

  return [value, setStoredValue];
}

function formatInputValue(value: number, step: number): string {
  if (Number.isInteger(step)) {
    return String(value);
  }

  const decimals = String(step).split(".")[1]?.length ?? 2;
  return value.toFixed(Math.min(4, decimals));
}

function parseNumberDraft(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (normalized === "" || normalized === "-" || normalized === "." || normalized === "-.") {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
