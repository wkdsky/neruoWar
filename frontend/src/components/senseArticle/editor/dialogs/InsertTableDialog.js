import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, StretchHorizontal, TableProperties } from 'lucide-react';
import DialogFrame from './DialogFrame';
import { TABLE_STYLE_OPTIONS } from '../table/tableSchema';
import { TABLE_WIDTH_MODES } from '../table/tableWidthUtils';

const QUICK_SIZES = [
  { rows: 2, cols: 2 },
  { rows: 3, cols: 3 },
  { rows: 4, cols: 4 },
  { rows: 5, cols: 3 }
];
const LAST_TABLE_CONFIG_KEY = 'sense-rich-editor.last-table-config';

const InsertTableDialog = ({ open, onClose, onSubmit }) => {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [withHeaderRow, setWithHeaderRow] = useState(true);
  const [withHeaderColumn, setWithHeaderColumn] = useState(false);
  const [tableStyle, setTableStyle] = useState('default');
  const [tableWidthMode, setTableWidthMode] = useState('full');

  useEffect(() => {
    if (!open) return;
    try {
      const stored = JSON.parse(window.localStorage.getItem(LAST_TABLE_CONFIG_KEY) || '{}');
      setRows(Number(stored.rows || 3));
      setCols(Number(stored.cols || 3));
      setWithHeaderRow(Boolean(stored.withHeaderRow ?? true));
      setWithHeaderColumn(Boolean(stored.withHeaderColumn));
      setTableStyle(stored.tableStyle || 'default');
      setTableWidthMode('full');
    } catch (_error) {
      setRows(3);
      setCols(3);
      setWithHeaderRow(true);
      setWithHeaderColumn(false);
      setTableStyle('default');
      setTableWidthMode('full');
    }
  }, [open]);

  const footer = useMemo(() => (
    <>
      <button type="button" className="btn btn-secondary" onClick={onClose}>取消</button>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => {
          const payload = {
            rows: Math.max(2, Math.min(12, Number(rows) || 3)),
            cols: Math.max(2, Math.min(8, Number(cols) || 3)),
            withHeaderRow,
            withHeaderColumn,
            tableStyle,
            tableWidthMode
          };
          window.localStorage.setItem(LAST_TABLE_CONFIG_KEY, JSON.stringify(payload));
          onSubmit(payload);
        }}
      >
        插入表格
      </button>
    </>
  ), [cols, onClose, onSubmit, rows, tableStyle, tableWidthMode, withHeaderColumn, withHeaderRow]);

  return (
    <DialogFrame open={open} title="插入表格" description="设置表格尺寸、表头和样式；最近一次配置会缓存在本地。" onClose={onClose} footer={footer}>
      <div className="sense-rich-form-grid">
        <div className="sense-rich-quick-size-grid">
          {QUICK_SIZES.map((size) => (
            <button key={`${size.rows}x${size.cols}`} type="button" className="btn btn-small btn-secondary" onClick={() => {
              setRows(size.rows);
              setCols(size.cols);
            }}>
              {size.rows} × {size.cols}
            </button>
          ))}
        </div>
        <label>
          <span>行数</span>
          <input type="number" min="2" max="12" value={rows} onChange={(event) => setRows(event.target.value)} />
        </label>
        <label>
          <span>列数</span>
          <input type="number" min="2" max="8" value={cols} onChange={(event) => setCols(event.target.value)} />
        </label>
        <label>
          <span>表格样式</span>
          <div className="sense-rich-dialog-select">
            <TableProperties size={16} className="sense-rich-dialog-select-icon" />
            <select value={tableStyle} onChange={(event) => setTableStyle(event.target.value)}>
              {TABLE_STYLE_OPTIONS.map((item) => (
                <option key={item} value={item}>
                  {item === 'default' ? '常规' : item === 'compact' ? '紧凑' : item === 'zebra' ? '斑马纹' : '三线表'}
                </option>
              ))}
            </select>
            <ChevronDown size={16} className="sense-rich-dialog-select-caret" />
          </div>
        </label>
        <label>
          <span>初始宽度</span>
          <div className="sense-rich-dialog-select">
            <StretchHorizontal size={16} className="sense-rich-dialog-select-icon" />
            <select value={tableWidthMode} onChange={(event) => setTableWidthMode(event.target.value)}>
              {TABLE_WIDTH_MODES.filter((item) => item !== 'custom').map((item) => (
                <option key={item} value={item}>
                  {item === 'auto' ? '自适应' : item === 'narrow' ? '窄' : item === 'medium' ? '中' : item === 'wide' ? '宽' : '全宽'}
                </option>
              ))}
            </select>
            <ChevronDown size={16} className="sense-rich-dialog-select-caret" />
          </div>
        </label>
        <label className="sense-rich-checkbox-row">
          <input type="checkbox" checked={withHeaderRow} onChange={(event) => setWithHeaderRow(event.target.checked)} />
          <span>首行作为表头</span>
        </label>
        <label className="sense-rich-checkbox-row">
          <input type="checkbox" checked={withHeaderColumn} onChange={(event) => setWithHeaderColumn(event.target.checked)} />
          <span>首列作为表头</span>
        </label>
      </div>
    </DialogFrame>
  );
};

export default InsertTableDialog;
