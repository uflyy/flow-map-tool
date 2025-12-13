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
import { Search, Map as MapIcon, Table, Upload, AlertCircle, Link as LinkIcon, MapPin } from 'lucide-react';

import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

// -------------------------
// CSV 解析器（保持你原来的逻辑）
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

// -------------------------
// 地图组件（Leaflet + OSM）
// -------------------------
type FlowRow = any & {
  displayValue: number;
  displayType: 'total' | 'leisure' | 'business';
  oCoords?: [number, number]; // [lat, lon]
  dCoords?: [number, number];
};

const USAMapVisualization = ({ flows }: { flows: FlowRow[] }) => {
  // 美国本土大致边界
  const bounds: [[number, number], [number, number]] = [
    [24.0, -126.0],
    [50.0, -66.0],
  ];

  // 点位去重
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

          const weight = Math.max(1, Math.log(f.displayValue + 1) / 3);
          const color = f.displayType === 'business' ? '#8b5cf6' : '#3b82f6';

          return (
            <Polyline
              key={`line-${i}`}
              positions={[f.oCoords, f.dCoords]}
              pathOptions={{ color, weight, opacity: 0.55 }}
            >
              <Tooltip sticky>
                <div className="text-xs">
                  <div className="font-semibold">
                    {f.origin_name} → {f.destination_name}
                  </div>
                  <div>Type: {f.displayType}</div>
                  <div>Vol: {formatNumber(f.displayValue)}</div>
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
              <div className="text-xs">
                <div className="font-semibold">{p.name}</div>
                <div className="font-mono">
                  {p.coords[0].toFixed(2)}, {p.coords[1].toFixed(2)}
                </div>
              </div>
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>

      {/* 图例 */}
      <div className="absolute bottom-2 right-2 bg-white/95 backdrop-blur px-3 py-2 rounded-lg text-xs text-gray-600 shadow-md border border-gray-100 flex flex-col gap-1 pointer-events-none">
        <div className="font-bold text-gray-800 border-b pb-1 mb-1">地图图例</div>
        <div className="flex items-center gap-2">
          <span className="w-8 h-1 bg-blue-500 rounded-full"></span>
          <span>休闲出行流 (Leisure)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-8 h-1 bg-purple-500 rounded-full"></span>
          <span>商务出行流 (Business)</span>
        </div>
        <div className="mt-1 text-[10px] text-gray-400">数据源: /yy.csv (lat_o, lon_o, lat_d, lon_d)</div>
      </div>
    </div>
  );
};

export default function TravelUSADashboard() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsedCount, setParsedCount] = useState(0);

  const [selectedYear, setSelectedYear] = useState<'All' | '2020' | '2021' | '2022'>('All');
  const [selectedType, setSelectedType] = useState<'total' | 'leisure' | 'business'>('total');
  const [searchOrigin, setSearchOrigin] = useState('');
  const [searchDest, setSearchDest] = useState('');

  // 自动加载：从服务器静态文件 /yy.csv
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/yy.csv', { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to load /yy.csv');
        const txt = await res.text();
        const parsed = parseCSV(txt);
        if (parsed.length === 0) throw new Error('Empty CSV');
        setData(parsed);
        setParsedCount(parsed.length);
      } catch (e) {
        setError('无法自动加载 /yy.csv，请确认已把 yy.csv 放到站点 public 目录，或手动上传。');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const handleFileUpload = async (event: any) => {
    const file = event.target.files?.[0];
    if (file) {
      setLoading(true);
      try {
        const text = await file.text();
        const parsedData = parseCSV(text);
        setData(parsedData);
        setParsedCount(parsedData.length);
        setError(null);
      } catch (err) {
        setError('文件解析失败');
      } finally {
        setLoading(false);
      }
    }
  };

  // 过滤 + displayValue
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
        return { ...row, displayValue: displayValue || 0, displayType: selectedType };
      })
      .filter((row: any) => row.displayValue > 0)
      .sort((a: any, b: any) => b.displayValue - a.displayValue);
  }, [data, selectedYear, selectedType, searchOrigin, searchDest]);

  // 地图数据：Top 200，校验坐标
  const mapData: FlowRow[] = useMemo(() => {
    return filteredData
      .slice(0, 200)
      .map((row: any) => {
        const lonO = parseFloat(row.lon_o);
        const latO = parseFloat(row.lat_o);
        const lonD = parseFloat(row.lon_d);
        const latD = parseFloat(row.lat_d);

        if (!isNaN(lonO) && !isNaN(latO) && !isNaN(lonD) && !isNaN(latD)) {
          return {
            ...row,
            oCoords: [latO, lonO],
            dCoords: [latD, lonD],
          };
        }
        return null;
      })
      .filter(Boolean) as FlowRow[];
  }, [filteredData]);

  const totalStats = useMemo(() => filteredData.reduce((acc, c) => acc + (c.displayValue || 0), 0), [filteredData]);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans text-gray-800">
      <header className="bg-slate-900 text-white p-4 shadow-lg sticky top-0 z-50">
        <div className="container mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2">
            <MapIcon className="w-6 h-6 text-blue-400" />
            <h1 className="text-xl font-bold tracking-tight">
              Pulse of American Domestic Tourism <span className="text-slate-400 font-normal">| 流量与空间分析</span>
            </h1>
          </div>
          <div className="text-xs text-slate-400 hidden md:flex items-center gap-2">
            <div className="flex items-center gap-1">
              <MapPin className="w-3 h-3" /> 坐标源: /yy.csv
            </div>
            <div className="h-3 w-[1px] bg-slate-700"></div>
            <div>记录数: {parsedCount}</div>
          </div>
        </div>
      </header>

      <main className="flex-grow container mx-auto p-4 flex flex-col gap-6">
        {data.length === 0 && !loading && (
          <div className="bg-white p-10 rounded-xl shadow-lg border border-gray-200 text-center max-w-2xl mx-auto mt-10">
            <div className="bg-blue-50 p-4 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
              <Upload className="w-8 h-8 text-blue-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">上传数据文件</h2>
            <p className="text-gray-500 mb-6">
              自动加载失败时，可上传包含 <code className="bg-gray-100 px-1 rounded text-pink-600">lat_o</code>,{' '}
              <code className="bg-gray-100 px-1 rounded text-pink-600">lon_o</code>,{' '}
              <code className="bg-gray-100 px-1 rounded text-pink-600">lat_d</code>,{' '}
              <code className="bg-gray-100 px-1 rounded text-pink-600">lon_d</code> 的 CSV。
            </p>
            {error && (
              <div className="mb-4 bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-center justify-center gap-2">
                <AlertCircle className="w-4 h-4" /> {error}
              </div>
            )}
            <label className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-lg cursor-pointer transition-all shadow-md hover:shadow-lg inline-flex items-center gap-2 font-medium">
              选择本地文件 (yy.csv)
              <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
            </label>
            <div className="mt-4 text-xs text-gray-500 flex items-center justify-center gap-2">
              <LinkIcon className="w-3 h-3" />
              <span>提示：若要自动加载，请把 yy.csv 放到站点 public 目录，使其可通过 /yy.csv 访问。</span>
            </div>
          </div>
        )}

        {data.length > 0 && (
          <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">年份 (Year)</label>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value as any)}
                className="w-full bg-gray-50 border border-gray-300 rounded-lg p-2.5 text-sm"
              >
                <option value="All">全部 (2020-2022)</option>
                <option value="2020">2020</option>
                <option value="2021">2021</option>
                <option value="2022">2022</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">出行目的 (Purpose)</label>
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value as any)}
                className="w-full bg-gray-50 border border-gray-300 rounded-lg p-2.5 text-sm"
              >
                <option value="total">全部 (Total)</option>
                <option value="leisure">休闲 (Leisure)</option>
                <option value="business">商务 (Business)</option>
              </select>
            </div>

            <div className="md:col-span-3">
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">客源地 (Origin)</label>
              <div className="relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
                <input
                  type="text"
                  value={searchOrigin}
                  onChange={(e) => setSearchOrigin(e.target.value)}
                  className="bg-gray-50 border border-gray-300 rounded-lg w-full pl-10 p-2.5 text-sm"
                  placeholder="Search Origin..."
                />
              </div>
            </div>

            <div className="md:col-span-3">
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">目的地 (Dest)</label>
              <div className="relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
                <input
                  type="text"
                  value={searchDest}
                  onChange={(e) => setSearchDest(e.target.value)}
                  className="bg-gray-50 border border-gray-300 rounded-lg w-full pl-10 p-2.5 text-sm"
                  placeholder="Search Dest..."
                />
              </div>
            </div>

            <div className="md:col-span-2">
              <div className="bg-slate-100 border border-slate-200 px-3 py-2 rounded-lg text-right">
                <span className="block text-[10px] uppercase text-slate-500 font-bold">总出行人次</span>
                <span className="text-lg font-bold text-slate-800">{formatNumber(totalStats)}</span>
              </div>
            </div>
          </div>
        )}

        {loading && (
          <div className="bg-white p-4 rounded-xl border border-gray-200 text-sm text-gray-600">
            正在加载数据，请稍候…
          </div>
        )}

        {data.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[600px]">
            <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col">
              <div className="p-3 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                <h3 className="font-semibold text-gray-700 flex items-center gap-2 text-sm">
                  <MapIcon className="w-4 h-4" /> OD 流量地图 (显示 Top 200)
                </h3>
              </div>
              <div className="flex-grow p-4 bg-white relative">
                <USAMapVisualization flows={mapData} />
              </div>
            </div>

            <div className="lg:col-span-1 bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col overflow-hidden">
              <div className="p-3 border-b border-gray-100 bg-gray-50">
                <h3 className="font-semibold text-gray-700 text-sm">Top 15 最繁忙路线</h3>
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
                <Table className="w-4 h-4" /> 数据明细
              </h3>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-sm text-left text-gray-500">
                <thead className="text-xs text-gray-700 uppercase bg-gray-50 sticky top-0 z-10">
                  <tr>
                    <th className="px-6 py-3">Year</th>
                    <th className="px-6 py-3">Origin (Lat/Lon)</th>
                    <th className="px-6 py-3">Destination (Lat/Lon)</th>
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
                        <div className="text-xs text-gray-400 font-mono">
                          {Number(row.lat_o).toFixed(2)}, {Number(row.lon_o).toFixed(2)}
                        </div>
                      </td>
                      <td className="px-6 py-3">
                        <div className="text-gray-900 font-medium">{row.destination_name}</div>
                        <div className="text-xs text-gray-400 font-mono">
                          {Number(row.lat_d).toFixed(2)}, {Number(row.lon_d).toFixed(2)}
                        </div>
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
