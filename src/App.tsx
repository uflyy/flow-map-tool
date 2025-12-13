import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
} from 'recharts';
import { Search, Map as MapIcon, Table, Upload, AlertCircle, MapPin } from 'lucide-react';

import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

// -------------------------
// CSV parser
// -------------------------
const parseCSV = (csvText: string) => {
  const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== '');
  if (lines.length === 0) return [];

  const headers = lines[0].split(',').map(h => h.trim());
  const data: any[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const row: any = {};
    let currentVal = '';
    let inQuote = false;
    let colIndex = 0;

    for (let charIndex = 0; charIndex < line.length; charIndex++) {
      const char = line[charIndex];
      if (char === '"') {
        inQuote = !inQuote;
      } else if (char === ',' && !inQuote) {
        if (colIndex < headers.length) {
          let val: any = currentVal.trim();
          if (!isNaN(val) && val !== '') val = Number(val);
          if (typeof val === 'string' && val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
          row[headers[colIndex]] = val;
        }
        colIndex++;
        currentVal = '';
      } else {
        currentVal += char;
      }
    }

    if (colIndex < headers.length) {
      let val: any = currentVal.trim();
      if (!isNaN(val) && val !== '') val = Number(val);
      if (typeof val === 'string' && val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      row[headers[colIndex]] = val;
    }
    data.push(row);
  }
  return data;
};

const formatNumber = (num: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(num);

const toNum = (v: any) => {
  const s = String(v ?? '').trim().replaceAll('"', '');
  const x = Number(s);
  return Number.isFinite(x) ? x : NaN;
};

const fixLon = (lon: number) => (lon > 0 ? -lon : lon);

// -------------------------
// Types
// -------------------------
type FlowRow = any & {
  displayValue: number;
  displayType: 'total' | 'leisure' | 'business';
  oCoords?: [number, number]; // [lat, lon]
  dCoords?: [number, number];
};

type FileStatus = 'connected' | 'not_found';

// -------------------------
// UI: file badge (academic style)
// -------------------------
const FileBadge = ({ status }: { status: FileStatus }) => {
  const connected = status === 'connected';
  const dotClass = connected ? 'bg-green-400' : 'bg-red-400';
  const textClass = connected ? 'text-green-300' : 'text-red-300';
  const label = connected ? 'File connected' : 'File not found';
  const help = connected
    ? 'Data successfully loaded (auto-load or manual upload).'
    : 'No file loaded. Check server static file path or upload a CSV.';

  return (
    <div className="flex items-center gap-2" title={help}>
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${dotClass}`} />
      <span className={`font-medium ${textClass}`}>{label}</span>
    </div>
  );
};

// -------------------------
// Map component (Leaflet + OSM)
// -------------------------
const USAMapVisualization = ({ flows }: { flows: FlowRow[] }) => {
  // Contiguous US bounds
  const bounds: [[number, number], [number, number]] = [
    [24.0, -126.0],
    [50.0, -66.0],
  ];

  // Scheme A (improved contrast):
  // log1p + min-max normalize within CURRENT displayed flows,
  // then map to a wider stroke-width range.
  const { minLog, maxLog } = useMemo(() => {
    if (!flows.length) return { minLog: 0, maxLog: 1 };
    const logs = flows.map(f => Math.log1p(Math.max(0, Number(f.displayValue) || 0)));
    const minL = Math.min(...logs);
    const maxL = Math.max(...logs);
    return { minLog: minL, maxLog: Math.max(maxL, minL + 1e-6) };
  }, [flows]);

  const minW = 0.8;
  const maxW = 14.0;

  const strokeFor = (vRaw: number) => {
    const v = Math.max(0, vRaw);
    const logv = Math.log1p(v);
    const t = (logv - minLog) / (maxLog - minLog); // 0..1 within current flows
    // slight nonlinearity to emphasize large flows without killing small ones
    const t2 = Math.pow(Math.min(1, Math.max(0, t)), 1.15);
    return minW + t2 * (maxW - minW);
  };

  // Unique points
  const points = useMemo(() => {
    const m = new Map<string, { name: string; coords: [number, number] }>();
    flows.forEach(f => {
      if (f.oCoords) m.set(`o:${f.origin_name}`, { name: f.origin_name, coords: f.oCoords });
      if (f.dCoords) m.set(`d:${f.destination_name}`, { name: f.destination_name, coords: f.dCoords });
    });
    return Array.from(m.values());
  }, [flows]);

  return (
    <div className="w-full h-full rounded-xl overflow-hidden border border-slate-200 relative">
      <MapContainer
        bounds={bounds}
        maxBounds={bounds}
        maxBoundsViscosity={0.8}
        style={{ width: '100%', height: '100%' }}
        scrollWheelZoom
        zoomControl
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {flows.map((f, i) => {
          if (!f.oCoords || !f.dCoords) return null;

          const v = Math.max(0, Number(f.displayValue) || 0);
          const weight = strokeFor(v);
          const color = f.displayType === 'business' ? '#8b5cf6' : '#3b82f6';

          return (
            <Polyline
              key={`line-${i}`}
              positions={[f.oCoords, f.dCoords]}
              pathOptions={{ color, weight, opacity: 0.65 }}
            >
              <Tooltip sticky>
                <div className="text-xs">
                  <div className="font-semibold">
                    {f.origin_name} → {f.destination_name}
                  </div>
                  <div>Type: {f.displayType}</div>
                  <div>Vol: {formatNumber(v)}</div>
                  <div className="text-[10px] text-gray-500 mt-1">Line width is log-scaled by flow volume</div>
                </div>
              </Tooltip>
            </Polyline>
          );
        })}

        {points.map((p, i) => (
          <CircleMarker
            key={`pt-${i}`}
            center={p.coords}
            radius={3}
            pathOptions={{ color: '#0f172a', fillColor: '#0f172a', fillOpacity: 0.9, weight: 1 }}
          >
            <Tooltip sticky>
               <div className="text-xs font-semibold">{p.name}</div>
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>

      {/* Legend */}
      <div className="absolute bottom-2 right-2 bg-white/95 backdrop-blur px-3 py-2 rounded-lg text-xs text-gray-600 shadow-md border border-gray-100 flex flex-col gap-1 pointer-events-none">
        <div className="font-bold text-gray-800 border-b pb-1 mb-1">Legend</div>
        <div className="flex items-center gap-2">
          <span className="w-8 h-1 bg-blue-500 rounded-full"></span>
          <span>Leisure flow</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-8 h-1 bg-purple-500 rounded-full"></span>
          <span>Business flow</span>
        </div>
        <div className="mt-1 text-[10px] text-gray-400">Line width ∝ log(flow volume), normalized within current view</div>
      </div>
    </div>
  );
};

// -------------------------
// Main component
// -------------------------
export default function App() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsedCount, setParsedCount] = useState(0);
  const [fileStatus, setFileStatus] = useState<FileStatus>('not_found');

  // Filters
  const [selectedYear, setSelectedYear] = useState<'All' | '2020' | '2021' | '2022'>('All');
  const [selectedType, setSelectedType] = useState<'total' | 'leisure' | 'business'>('total');
  const [searchOrigin, setSearchOrigin] = useState('');
  const [searchDest, setSearchDest] = useState('');

  // Top-N selector for map
  const [topN, setTopN] = useState<50 | 100 | 200>(50);

  // Auto-load from server static file
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      setFileStatus('not_found'); // 默认先认为没连上

      try {
        const res = await fetch('/yy1.csv'); // ← 你现在的文件名

        if (!res.ok) throw new Error('Fetch failed');

        const text = await res.text();

        // 关键防线 1：防止 Vite 返回 index.html
        if (
          text.trim().startsWith('<!DOCTYPE') ||
          text.trim().startsWith('<html')
        ) {
          throw new Error('HTML returned instead of CSV');
        }

        const parsed = parseCSV(text);

        // 关键防线 2：必须有数据
        if (!parsed || parsed.length === 0) {
          throw new Error('Empty or invalid CSV');
        }

        setData(parsed);
        setParsedCount(parsed.length);
        setFileStatus('connected'); // ✅ 只有这里才算真正 connected
      } catch (err) {
        console.warn('CSV load failed:', err);
        setData([]);
        setParsedCount(0);
        setFileStatus('not_found');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);


  // Manual upload fallback
  const handleFileUpload = async (event: any) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      const text = await file.text();
      const parsedData = parseCSV(text);
      if (parsedData.length === 0) throw new Error('Empty CSV');
      setData(parsedData);
      setParsedCount(parsedData.length);
      setFileStatus('connected');
      setError(null);
    } catch (err) {
      setFileStatus('not_found');
      setError('File parsing failed. Please check the CSV format.');
    } finally {
      setLoading(false);
    }
  };

  // Filtered rows + displayValue
  const filteredData: FlowRow[] = useMemo(() => {
    return data
      .filter((row: any) => {
        if (selectedYear !== 'All' && row.year !== parseInt(selectedYear)) return false;
        if (searchOrigin && row.origin_name && !String(row.origin_name).toLowerCase().includes(searchOrigin.toLowerCase()))
          return false;
        if (searchDest && row.destination_name && !String(row.destination_name).toLowerCase().includes(searchDest.toLowerCase()))
          return false;
        return true;
      })
      .map((row: any) => {
        let displayValue = 0;
        if (selectedType === 'leisure') displayValue = row.total_wt_l_all;
        else if (selectedType === 'business') displayValue = row.total_wt_b_all;
        else displayValue = row.total_wt_t_all;
        return { ...row, displayValue: Number(displayValue) || 0, displayType: selectedType };
      })
      .filter((row: any) => row.displayValue > 0)
      .sort((a: any, b: any) => b.displayValue - a.displayValue);
  }, [data, selectedYear, selectedType, searchOrigin, searchDest]);

  // Map data (Top N) with robust coordinate parsing + lon fix
  const mapData: FlowRow[] = useMemo(() => {
    return filteredData
      .slice(0, topN)
      .map((row: any) => {
        const lonO = fixLon(toNum(row.lon_o));
        const latO = toNum(row.lat_o);
        const lonD = fixLon(toNum(row.lon_d));
        const latD = toNum(row.lat_d);

        if (
          Number.isFinite(lonO) && Number.isFinite(latO) &&
          Number.isFinite(lonD) && Number.isFinite(latD)
        ) {
          return {
            ...row,
            oCoords: [latO, lonO],
            dCoords: [latD, lonD],
          };
        }
        return null;
      })
      .filter(Boolean) as FlowRow[];
  }, [filteredData, topN]);

  const totalStats = useMemo(() => filteredData.reduce((acc, c) => acc + (c.displayValue || 0), 0), [filteredData]);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans text-gray-800">
      <header className="bg-slate-900 text-white p-4 shadow-lg sticky top-0 z-50">
        <div className="container mx-auto flex justify-between items-center gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {/* Logos: put files in public/temple.png and public/villanova.png */}
            <div className="flex items-center gap-2 shrink-0">
              <img src="/temple.png" alt="Temple University" className="h-9 w-auto rounded bg-white p-1" />
              <img src="/villanova.png" alt="Villanova University" className="h-9 w-auto rounded bg-white p-1" />
            </div>

            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-tight truncate">
                Pulse of American Domestic Tourism <span className="text-slate-400 font-normal">| Flow Map Dashboard</span>
              </h1>
              <div className="text-xs text-slate-400 mt-1">
                By Dr. Yang Yang (Temple) and Dr. Chenfeng Xiong (Villanova)
              </div>
            </div>
          </div>

          <div className="text-xs text-slate-300 hidden md:flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-2">
              <MapPin className="w-3 h-3" />
              <FileBadge status={fileStatus} />
            </div>
            <div className="h-3 w-[1px] bg-slate-700"></div>
            <div className="flex flex-col items-end leading-tight">
              <div>Records: {parsedCount}</div>
              <a
                href="/user-manual.pdf"
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-slate-300 hover:text-white underline underline-offset-2"
              >
                User manual (PDF)
              </a>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-grow container mx-auto p-4 flex flex-col gap-6">
        {data.length === 0 && !loading && (
          <div className="bg-white p-10 rounded-xl shadow-lg border border-gray-200 text-center max-w-2xl mx-auto mt-10">
            <div className="bg-blue-50 p-4 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
              <Upload className="w-8 h-8 text-blue-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Connect a data file</h2>
            <p className="text-gray-500 mb-6">
              Upload a CSV containing <code className="bg-gray-100 px-1 rounded text-pink-600">lat_o</code>,{' '}
              <code className="bg-gray-100 px-1 rounded text-pink-600">lon_o</code>,{' '}
              <code className="bg-gray-100 px-1 rounded text-pink-600">lat_d</code>,{' '}
              <code className="bg-gray-100 px-1 rounded text-pink-600">lon_d</code>, plus flow columns.
            </p>

            {error && (
              <div className="mb-4 bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-center justify-center gap-2">
                <AlertCircle className="w-4 h-4" /> {error}
              </div>
            )}

            <label className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-lg cursor-pointer transition-all shadow-md hover:shadow-lg inline-flex items-center gap-2 font-medium">
              Upload CSV
              <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
            </label>

            <div className="mt-4 text-xs text-gray-500">
              Tip: If you deploy with a server static file, the dashboard can auto-connect at startup.
            </div>
          </div>
        )}

        {loading && (
          <div className="bg-white p-4 rounded-xl border border-gray-200 text-sm text-gray-600">
            Loading data, please wait…
          </div>
        )}

        {data.length > 0 && (
          <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Year</label>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value as any)}
                className="w-full bg-gray-50 border border-gray-300 rounded-lg p-2.5 text-sm"
              >
                <option value="All">All (2020-2022)</option>
                <option value="2020">2020</option>
                <option value="2021">2021</option>
                <option value="2022">2022</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Purpose</label>
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value as any)}
                className="w-full bg-gray-50 border border-gray-300 rounded-lg p-2.5 text-sm"
              >
                <option value="total">Total</option>
                <option value="leisure">Leisure</option>
                <option value="business">Business</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Map Top-N</label>
              <select
                value={topN}
                onChange={(e) => setTopN(Number(e.target.value) as 50 | 100 | 200)}
                className="w-full bg-gray-50 border border-gray-300 rounded-lg p-2.5 text-sm"
              >
                <option value={50}>Top 50</option>
                <option value={100}>Top 100</option>
                <option value={200}>Top 200</option>
              </select>
            </div>

            <div className="md:col-span-3">
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Origin</label>
              <div className="relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
                <input
                  type="text"
                  value={searchOrigin}
                  onChange={(e) => setSearchOrigin(e.target.value)}
                  className="bg-gray-50 border border-gray-300 rounded-lg w-full pl-10 p-2.5 text-sm"
                  placeholder="Search origin..."
                />
              </div>
            </div>

            <div className="md:col-span-3">
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Destination</label>
              <div className="relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
                <input
                  type="text"
                  value={searchDest}
                  onChange={(e) => setSearchDest(e.target.value)}
                  className="bg-gray-50 border border-gray-300 rounded-lg w-full pl-10 p-2.5 text-sm"
                  placeholder="Search destination..."
                />
              </div>
            </div>

            
          </div>
        )}

        {data.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[600px]">
            <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col">
              <div className="p-3 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                <h3 className="font-semibold text-gray-700 flex items-center gap-2 text-sm">
                  <MapIcon className="w-4 h-4" /> OD Flow Map (Top {topN})
                </h3>
                <div className="text-xs text-gray-500">
                  Showing {mapData.length} flows
                </div>
              </div>
              <div className="flex-grow p-4 bg-white relative">
                <USAMapVisualization flows={mapData} />
              </div>
            </div>

            <div className="lg:col-span-1 bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col overflow-hidden">
              <div className="p-3 border-b border-gray-100 bg-gray-50">
                <h3 className="font-semibold text-gray-700 text-sm">Top 15 busiest routes</h3>
              </div>
              <div className="p-4 flex-grow">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    layout="vertical"
                    data={filteredData.slice(0, 15).map(d => ({
                      name: `${String(d.origin_name).split(',')[0]} → ${String(d.destination_name).split(',')[0]}`,
                      value: d.displayValue,
                    }))}
                    margin={{ left: 10, right: 30 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 10 }} interval={0} />
                    <RechartsTooltip formatter={(v: any) => formatNumber(Number(v))} cursor={{ fill: 'transparent' }} />
                    <Bar
                      dataKey="value"
                      fill={selectedType === 'business' ? '#8b5cf6' : '#3b82f6'}
                      radius={[0, 4, 4, 0]}
                      barSize={15}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {data.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col flex-grow min-h-[300px]">
            <div className="p-3 border-b border-gray-100 bg-gray-50">
              <h3 className="font-semibold text-gray-700 text-sm flex items-center gap-2">
                <Table className="w-4 h-4" /> Data table (Top 100)
              </h3>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-sm text-left text-gray-500">
                <thead className="text-xs text-gray-700 uppercase bg-gray-50 sticky top-0 z-10">
                  <tr>
                    <th className="px-6 py-3">Year</th>
                    <th className="px-6 py-3">Origin</th>
                    <th className="px-6 py-3">Destination</th>
                    <th className="px-6 py-3 text-right">Leisure</th>
                    <th className="px-6 py-3 text-right">Business</th>
                    <th className="px-6 py-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredData.slice(0, 100).map((row: any, i: number) => (
                    <tr key={i} className="bg-white border-b hover:bg-gray-50">
                      <td className="px-6 py-3 font-medium">{row.year}</td>
                      <td className="px-6 py-3">
                        <div className="text-gray-900 font-medium">{row.origin_name}</div>
                      </td>
                      <td className="px-6 py-3">
                        <div className="text-gray-900 font-medium">{row.destination_name}</div>
                      </td>
                      <td className="px-6 py-3 text-right font-mono text-blue-600">{formatNumber(Number(row.total_wt_l_all))}</td>
                      <td className="px-6 py-3 text-right font-mono text-purple-600">{formatNumber(Number(row.total_wt_b_all))}</td>
                      <td className="px-6 py-3 text-right font-bold font-mono">{formatNumber(Number(row.total_wt_t_all))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
