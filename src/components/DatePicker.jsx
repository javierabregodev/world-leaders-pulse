import { useState, useRef, useEffect } from 'react';

const PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: '7 Days' },
  { key: '30d', label: '30 Days' },
  { key: '365d', label: '365 Days' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function DatePicker({ value, onChange }) {
  const [showPicker, setShowPicker] = useState(false);
  const [pickerYear, setPickerYear] = useState(new Date().getFullYear());
  const ref = useRef(null);

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setShowPicker(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  function handlePreset(key) {
    setShowPicker(false);
    onChange(key);
  }

  function handleMonthSelect(monthIdx) {
    setShowPicker(false);
    onChange({ type: 'month', year: pickerYear, month: monthIdx + 1, label: `${MONTHS[monthIdx]} ${pickerYear}` });
  }

  function handleYearSelect() {
    setShowPicker(false);
    onChange({ type: 'year', year: pickerYear, label: String(pickerYear) });
  }

  const activeKey = typeof value === 'string' ? value : null;
  const isMonthActive = typeof value === 'object' && value?.type === 'month';
  const isYearActive = typeof value === 'object' && value?.type === 'year';
  const calendarLabel = isMonthActive ? value.label : isYearActive ? String(value.year) : null;

  return (
    <div className="relative" ref={ref}>
      <div className="flex gap-0.5 bg-white border border-gray-200 rounded-xl p-0.5">
        {PRESETS.map(p => (
          <button
            key={p.key}
            onClick={() => handlePreset(p.key)}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
              activeKey === p.key
                ? 'bg-indigo-500 text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => { setShowPicker(!showPicker); setPickerYear(currentYear); }}
          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap flex items-center gap-1 ${
            (isMonthActive || isYearActive)
              ? 'bg-indigo-500 text-white shadow-sm'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          {calendarLabel || 'Month/Year'}
        </button>
      </div>

      {showPicker && (
        <div className="absolute top-full mt-2 right-0 bg-white rounded-xl border border-gray-200 shadow-xl z-30 w-[280px] p-3">
          {/* Year navigation */}
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => setPickerYear(y => Math.max(2020, y - 1))}
              disabled={pickerYear <= 2020}
              className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-30 flex items-center justify-center text-gray-600"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M10 4l-4 4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <span className="text-sm font-bold text-gray-900">{pickerYear}</span>
            <button
              onClick={() => setPickerYear(y => Math.min(currentYear, y + 1))}
              disabled={pickerYear >= currentYear}
              className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-30 flex items-center justify-center text-gray-600"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>

          {/* Full year button */}
          <button
            onClick={handleYearSelect}
            className={`w-full py-2 mb-2 rounded-lg text-xs font-medium transition-all border ${
              isYearActive && value.year === pickerYear
                ? 'bg-indigo-500 text-white border-indigo-500'
                : 'text-gray-600 border-gray-200 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200'
            }`}
          >
            Full year {pickerYear}
          </button>

          {/* Month grid */}
          <div className="grid grid-cols-4 gap-1.5">
            {MONTHS.map((m, i) => {
              const isFuture = pickerYear === currentYear && i > currentMonth;
              const isSelected = isMonthActive && value.year === pickerYear && value.month === i + 1;
              return (
                <button
                  key={m}
                  onClick={() => !isFuture && handleMonthSelect(i)}
                  disabled={isFuture}
                  className={`py-2 rounded-lg text-xs font-medium transition-all ${
                    isSelected
                      ? 'bg-indigo-500 text-white shadow-sm'
                      : isFuture
                        ? 'text-gray-300 cursor-not-allowed'
                        : 'text-gray-700 hover:bg-indigo-50 hover:text-indigo-600'
                  }`}
                >
                  {m}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** Compact inline date picker for chart sections */
export function InlineDatePicker({ value, onChange, options }) {
  return (
    <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5">
      {options.map(o => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all whitespace-nowrap ${
            value === o.key
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
