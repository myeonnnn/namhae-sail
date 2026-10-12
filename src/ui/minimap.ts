import 'ol/ol.css';
import Feature from 'ol/Feature';
import OlMap from 'ol/Map';
import View from 'ol/View';
import Attribution from 'ol/control/Attribution';
import ScaleLine from 'ol/control/ScaleLine';
import GeoJSON from 'ol/format/GeoJSON';
import LineString from 'ol/geom/LineString';
import Polygon from 'ol/geom/Polygon';
import Point from 'ol/geom/Point';
import VectorLayer from 'ol/layer/Vector';
import VectorImageLayer from 'ol/layer/VectorImage';
import { fromLonLat } from 'ol/proj';
import VectorSource from 'ol/source/Vector';
import CircleStyle from 'ol/style/Circle';
import Fill from 'ol/style/Fill';
import Icon from 'ol/style/Icon';
import RegularShape from 'ol/style/RegularShape';
import Stroke from 'ol/style/Stroke';
import Style from 'ol/style/Style';
import Text from 'ol/style/Text';
import { worldToLatLon } from '../geo/projection';
import { REGION } from '../geo/region';
import { formatLatLon } from '../geo/units';
import type { ShipState } from '../ship/shipPhysics';
import { loadChart, type ChartPlace, type PlaceKind } from '../world/chartData';
import { loadSeamarkRecords, type SeamarkRecord } from '../world/seamarkData';
import { WheelStepper } from './wheelStepper';

const LAND_URL = '/data/land.json';
// 지명은 종류에 따라 글자의 크기와 표시를 시작하는 축척이 다르다. 한 픽셀이 maxResolution(m)보다 넓으면 숨긴다.
const PLACE_STYLES: Record<PlaceKind, { font: string; color: string; maxResolution: number }> = {
  city: { font: '600 12px', color: '#1b2733', maxResolution: Infinity },
  town: { font: '500 10px', color: '#3a4652', maxResolution: 90 },
  island: { font: 'italic 500 10px', color: '#5b4a2c', maxResolution: 160 },
  village: { font: '400 9px', color: '#55606b', maxResolution: 25 },
  islet: { font: 'italic 400 9px', color: '#6f5d3c', maxResolution: 40 },
  peak: { font: '400 9px', color: '#6f5d3c', maxResolution: 25 },
};
const LABEL_FONT_FAMILY = "system-ui, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
const LABEL_HALO = new Stroke({ color: 'rgba(255, 255, 255, 0.85)', width: 2.5 });
const DEFAULT_ZOOM = 11;
const MIN_ZOOM = 7;
const MAX_ZOOM = 16;
// 이어지는 스크롤에서 줌을 바꾼 뒤에 다음 단계를 허용하기까지의 간격
const ZOOM_COOLDOWN_MS = 500;
// 지도의 중심과 자선의 표시를 갱신하는 간격. 매 프레임 갱신하면 육지의 폴리곤을 다시 그리는 비용이 커진다.
const REFRESH_INTERVAL_MS = 100;
// 항적에 점을 추가하는 이동 거리 (m)와 보관하는 점의 최대 개수
const TRACK_SPACING = 25;
const MAX_TRACK_POINTS = 3000;
// 지도를 축소했을 때 표지가 서로 겹쳐서 뭉치지 않도록, 한 픽셀이 이 거리(m)보다 넓어지면 종류별로 숨긴다.
const HIDE_RESOLUTION = { light: 160, beacon: 40, buoy: 40 } as const;

const MARK_COLOURS: Record<string, string> = {
  red: '#d0242c',
  green: '#1f9a4c',
  yellow: '#f0bd12',
  white: '#ffffff',
  black: '#1c1c1c',
  orange: '#e8742a',
};
const OUTLINE = new Stroke({ color: '#1b2733', width: 1 });

const SHIP_ICON = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="26" viewBox="-11 -13 22 26">' +
    '<path d="M0 -11 L7 8 L0 4 L-7 8 Z" fill="#e5352b" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/></svg>',
)}`;

/**
 * 자선을 중심으로 하는 북쪽 고정 해도. OpenLayers로 그린다.
 *
 * 외부의 지도 타일 서버를 조회하지 않는다. 육지는 OpenStreetMap의 해안선을 미리 가공한 폴리곤이고,
 * 해상 표지는 3D 화면과 같은 자료이므로 두 화면의 표지가 항상 일치한다.
 */
export class Minimap {
  private readonly position = document.createElement('div');
  private readonly view = new View({
    center: fromLonLat([REGION.starts[0].lon, REGION.starts[0].lat]),
    zoom: DEFAULT_ZOOM,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    enableRotation: false,
  });
  private readonly shipFeature = new Feature(new Point([0, 0]));
  // 관찰 모드에서 카메라가 보고 있는 지점을 표시하는 십자선
  private readonly focusFeature = new Feature(new Point([0, 0]));
  private readonly shipIcon = new Icon({ src: SHIP_ICON, rotateWithView: false });
  private readonly track = new LineString([]);
  private readonly markStyles = new Map<string, Style>();
  private lastRefreshTime = -Infinity;
  private lastTrackX = Infinity;
  private lastTrackZ = Infinity;
  private readonly wheel = new WheelStepper({ cooldownMs: ZOOM_COOLDOWN_MS });

  constructor(root: HTMLElement) {
    const panel = document.createElement('div');
    panel.className = 'hud-panel hud-minimap';
    const target = document.createElement('div');
    target.className = 'hud-minimap-view';
    this.position.className = 'hud-minimap-position';
    panel.append(target, this.position);
    root.append(panel);

    // 육지는 꼭짓점이 많아서, 그린 결과를 이미지로 보관했다가 재사용하는 레이어를 사용한다.
    const land = new VectorImageLayer({
      source: new VectorSource({ url: LAND_URL, format: new GeoJSON() }),
      style: new Style({
        fill: new Fill({ color: '#efe3c2' }),
        stroke: new Stroke({ color: '#8f8266', width: 1 }),
      }),
      imageRatio: 2,
    });

    const marks = new VectorSource();
    void loadSeamarkRecords()
      .then((records) =>
        marks.addFeatures(
          records.map((record) => {
            const feature = new Feature(new Point(fromLonLat([record.lon, record.lat])));
            feature.set('record', record);
            return feature;
          }),
        ),
      )
      .catch((error) => console.warn('지도에 표시할 해상 표지를 불러오지 못했습니다.', error));

    this.shipFeature.setStyle(new Style({ image: this.shipIcon }));
    this.focusFeature.setStyle(
      new Style({
        image: new RegularShape({ points: 4, radius: 9, radius2: 0, stroke: new Stroke({ color: '#1b2733', width: 2 }) }),
      }),
    );

    // 시가지, 방파제와 부두, 다리, 지명은 하나의 파일로 받아서 종류별 레이어에 나누어 넣는다.
    const urban = new VectorSource();
    const structures = new VectorSource();
    const bridges = new VectorSource();
    const places = new VectorSource();
    const ring = (points: [number, number][]) => points.map((point) => fromLonLat(point));
    void loadChart()
      .then((chart) => {
        urban.addFeatures(chart.urban.map((points) => new Feature(new Polygon([ring(points)]))));
        // 방파제와 부두는 면으로 등록된 것과 선으로 등록된 것이 섞여 있다.
        structures.addFeatures(
          chart.structures.map(
            ({ closed, points }) => new Feature(closed ? new Polygon([ring(points)]) : new LineString(ring(points))),
          ),
        );
        bridges.addFeatures(chart.bridges.map(({ points }) => new Feature(new LineString(ring(points)))));
        places.addFeatures(
          chart.places.map((place) => {
            const feature = new Feature(new Point(fromLonLat([place.lon, place.lat])));
            feature.set('place', place);
            return feature;
          }),
        );
      })
      .catch((error) => console.warn('해도의 육지 자료를 불러오지 못했습니다.', error));

    // 운영 구역의 경계. 이 선의 바깥으로는 항해할 수 없다.
    const { south, west, north, east } = REGION.bounds;
    const boundary = new Feature(
      new Polygon([ring([[west, south], [east, south], [east, north], [west, north], [west, south]])]),
    );

    new OlMap({
      target,
      view: this.view,
      layers: [
        land,
        new VectorLayer({ source: urban, style: new Style({ fill: new Fill({ color: '#dccba2' }) }) }),
        // 방파제는 지도를 축소하면 점으로 뭉쳐서 보이므로, 한 픽셀이 60m보다 넓어지면 숨긴다.
        new VectorLayer({
          source: structures,
          maxResolution: 60,
          style: new Style({ fill: new Fill({ color: '#6f6a60' }), stroke: new Stroke({ color: '#6f6a60', width: 2 }) }),
        }),
        new VectorLayer({
          source: bridges,
          // 바다를 건너는 다리만 남겼으므로, 넓게 볼 때에도 표시한다.
          maxResolution: 200,
          style: new Style({ stroke: new Stroke({ color: '#8a5a44', width: 2 }) }),
        }),
        new VectorLayer({
          source: new VectorSource({ features: [boundary] }),
          style: new Style({ stroke: new Stroke({ color: 'rgba(27, 39, 51, 0.55)', width: 1.5, lineDash: [6, 5] }) }),
        }),
        new VectorLayer({
          source: new VectorSource({ features: [new Feature(this.track)] }),
          style: new Style({ stroke: new Stroke({ color: 'rgba(229, 53, 43, 0.85)', width: 2 }) }),
        }),
        new VectorLayer({
          source: marks,
          style: (feature, resolution) => this.markStyle(feature.get('record') as SeamarkRecord, resolution),
        }),
        new VectorLayer({
          source: places,
          style: (feature, resolution) => this.placeStyle(feature.get('place') as ChartPlace, resolution),
          // 이름표가 서로 겹치면 나중에 그려지는 쪽을 생략한다.
          declutter: true,
        }),
        new VectorLayer({ source: new VectorSource({ features: [this.shipFeature, this.focusFeature] }) }),
      ],
      controls: [
        new ScaleLine({ units: 'metric', minWidth: 48 }),
        new Attribution({ collapsible: false, attributions: '© OpenStreetMap contributors' }),
      ],
      // 지도는 항상 자선을 따라가므로 OpenLayers의 기본 조작(끌어서 옮기기 등)은 모두 끈다.
      // 휠의 확대와 축소도 직접 처리한다. 기본 제공되는 휠 조작은 줌을 서서히 바꾸는데,
      // 지도의 중심을 계속 자선으로 옮기는 동작과 겹치면 줌이 바뀌다가 멈추는 경우가 있었다.
      interactions: [],
    });

    target.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        // 휠을 위로 돌리면(-1) 확대하고, 아래로 돌리면 축소한다.
        const step = this.wheel.feed(event.deltaY);
        if (step === 0) return;
        const zoom = Math.round(this.view.getZoom() ?? DEFAULT_ZOOM) - step;
        this.view.setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)));
      },
      { passive: false },
    );
  }

  /** 항적을 지운다. 배를 다른 곳으로 옮겼을 때, 이전의 위치와 새 위치가 직선으로 이어지지 않게 한다. */
  resetTrack(): void {
    this.track.setCoordinates([]);
    this.lastTrackX = Infinity;
    this.lastTrackZ = Infinity;
  }

  /**
   * @param focus 관찰 모드에서 카메라가 보고 있는 지점. 지정하면 지도가 배 대신 이 지점을 따라가고, 경위도도 이 지점의 값을 표시한다.
   */
  update(ship: ShipState, focus?: { x: number; z: number }): void {
    const now = performance.now();
    if (now - this.lastRefreshTime < REFRESH_INTERVAL_MS) return;
    this.lastRefreshTime = now;

    const { lat, lon } = worldToLatLon(ship.x, ship.z);
    const coordinate = fromLonLat([lon, lat]);
    const centre = focus ? worldToLatLon(focus.x, focus.z) : { lat, lon };
    const centreCoordinate = fromLonLat([centre.lon, centre.lat]);
    this.position.textContent = formatLatLon(centre.lat, centre.lon);

    this.view.setCenter(centreCoordinate);
    // 십자선은 관찰 모드에서만 보이도록, 평소에는 지도의 범위 밖으로 치워 둔다.
    (this.focusFeature.getGeometry() as Point).setCoordinates(focus ? centreCoordinate : [0, 0]);
    (this.shipFeature.getGeometry() as Point).setCoordinates(coordinate);
    this.shipIcon.setRotation(ship.heading);

    if (Math.hypot(ship.x - this.lastTrackX, ship.z - this.lastTrackZ) >= TRACK_SPACING) {
      this.lastTrackX = ship.x;
      this.lastTrackZ = ship.z;
      const coordinates = this.track.getCoordinates();
      coordinates.push(coordinate);
      if (coordinates.length > MAX_TRACK_POINTS) coordinates.shift();
      this.track.setCoordinates(coordinates);
    }
  }

  /** 지명의 이름표. 산의 봉우리는 높이를 함께 표시한다. */
  private placeStyle(place: ChartPlace, resolution: number): Style | undefined {
    const { font, color, maxResolution } = PLACE_STYLES[place.kind];
    if (resolution > maxResolution) return undefined;
    return new Style({
      text: new Text({
        text: place.kind === 'peak' && place.ele ? `▲ ${place.name} ${place.ele}` : place.name,
        font: `${font} ${LABEL_FONT_FAMILY}`,
        fill: new Fill({ color }),
        stroke: LABEL_HALO,
        overflow: true,
      }),
    });
  }

  /** 표지의 종류와 색상에 따른 기호. 같은 기호는 한 번만 만들어서 재사용한다. */
  private markStyle(record: SeamarkRecord, resolution: number): Style | undefined {
    if (resolution > HIDE_RESOLUTION[record.kind]) return undefined;

    // 등대는 구조물의 색상이 기록되어 있지 않은 경우가 많아서 등화의 색상으로 구분한다.
    const colour = MARK_COLOURS[(record.kind === 'light' ? record.light : record.colour) ?? 'white'] ?? '#ffffff';
    const key = `${record.kind}/${colour}`;
    let style = this.markStyles.get(key);
    if (!style) {
      const fill = new Fill({ color: colour });
      const image =
        record.kind === 'light'
          ? new RegularShape({ points: 5, radius: 5.5, radius2: 2.4, fill, stroke: OUTLINE })
          : record.kind === 'beacon'
            ? new RegularShape({ points: 4, radius: 4, angle: Math.PI / 4, fill, stroke: OUTLINE })
            : new CircleStyle({ radius: 3, fill, stroke: OUTLINE });
      style = new Style({ image });
      this.markStyles.set(key, style);
    }
    return style;
  }
}
