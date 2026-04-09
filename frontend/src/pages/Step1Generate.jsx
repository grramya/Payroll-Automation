import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import Spinner from '../components/Spinner'
import Alert from '../components/Alert'
import { useApp } from '../context/AppContext'
import { generateJE } from '../api/api'

function todayStr() {
  return new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
}

export default function Step1Generate() {
  const navigate = useNavigate()
  const { setJEData, setLoading, loading, loadingMsg } = useApp()

  const [file, setFile] = useState(null)
  const [journalNumber, setJournalNumber] = useState('')
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10))
  const [provisionDesc, setProvisionDesc] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [errors, setErrors] = useState({})
  const [apiError, setApiError] = useState('')
  const fileInputRef = useRef()

  // Auto-fill journal number from file name heuristic
  function handleFile(f) {
    setFile(f)
    setErrors((e) => ({ ...e, file: '' }))
    // Try to extract invoice date from file name (fallback)
    const m = f.name.match(/\d{1,2}[._\-\/]\d{1,2}[._\-\/]\d{4}/)
    if (m && !journalNumber) {
      setJournalNumber(`Salary for ${m[0].replace(/[._\-]/g, '/')}`)
    }
  }

  function validate() {
    const errs = {}
    if (!file) errs.file = 'A payroll file (.xlsx) is required'
    if (!journalNumber.trim()) errs.journalNumber = 'Journal Number is required'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleGenerate() {
    if (!validate()) return
    setApiError('')
    setLoading(true, 'Generating Journal Entry — please wait…')
    try {
      // Format date as MM/DD/YYYY for backend
      const [y, m, d] = entryDate.split('-')
      const fmtDate = `${m}/${d}/${y}`
      const result = await generateJE(file, journalNumber.trim(), fmtDate, provisionDesc)
      setJEData({
        sessionId: result.session_id,
        jeRows: result.je_rows,
        jeColumns: result.columns,
        jeFilename: result.je_filename,
        summary: result.summary,
        payrollGt: result.payroll_gt,
        jeProvision: result.je_provision,
        unmappedCols: result.unmapped_cols || [],
        naMappedCols: result.na_mapped_cols || [],
        deptSummary: result.dept_summary || [],
        warnings: result.warnings || [],
      })
      navigate('/step/2')
    } catch (err) {
      const detail = err.response?.data?.detail
      if (detail?.errors) {
        setApiError(detail.errors.join('\n'))
      } else {
        setApiError(typeof detail === 'string' ? detail : 'An unexpected error occurred.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      {loading && <Spinner label={loadingMsg} />}

      <PageHeader
        icon="upload_file"
        title="Generate Journal Entry"
        subtitle="Upload your Invoice Supporting Details file and generate a QuickBooks-ready Journal Entry."
      />

      {apiError && (
        <Alert type="error" onClose={() => setApiError('')}>
          {apiError}
        </Alert>
      )}

      {/* Section 1: Upload */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="section-header">
          <span className="section-badge">1</span>
          Upload Payroll File <span style={{ color: 'var(--err)', marginLeft: 2 }}>*</span>
        </div>
        <p className="section-hint">
          Drag and drop or browse for the Invoice Supporting Details Excel file (.xlsx).
        </p>

        <div
          className={`upload-zone${dragOver ? ' drag-over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            const f = e.dataTransfer.files[0]
            if (f) handleFile(f)
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            style={{ display: 'none' }}
            onChange={(e) => { if (e.target.files[0]) handleFile(e.target.files[0]) }}
          />
          <span className="material-icons-round">upload_file</span>
          <div className="upload-zone-text">
            {file ? (
              <span className="upload-zone-file">
                <span className="material-icons-round" style={{ fontSize: 16, verticalAlign: 'middle' }}>
                  description
                </span>{' '}
                {file.name}
              </span>
            ) : (
              'Click or drag & drop your .xlsx payroll file here'
            )}
          </div>
        </div>

        {errors.file && (
          <div className="field-err">
            <span className="material-icons-round">error_outline</span>
            {errors.file}
          </div>
        )}
      </div>

      {/* Section 2: Journal Settings */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="section-header">
          <span className="section-badge">2</span>
          Journal Settings
        </div>
        <p className="section-hint">
          Journal Number is auto-filled from the payroll file's invoice date.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label className="form-label">
              Journal Number <span className="req">*</span>
            </label>
            <input
              className={`form-input${errors.journalNumber ? ' error' : ''}`}
              value={journalNumber}
              onChange={(e) => {
                setJournalNumber(e.target.value)
                if (e.target.value.trim()) setErrors((er) => ({ ...er, journalNumber: '' }))
              }}
              placeholder="e.g. Salary for 03/31/2026"
            />
            {errors.journalNumber && (
              <div className="field-err">
                <span className="material-icons-round">error_outline</span>
                {errors.journalNumber}
              </div>
            )}
          </div>

          <div>
            <label className="form-label">Entry Date</label>
            <input
              className="form-input"
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
            />
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <label className="form-label">Provision Description (optional)</label>
          <input
            className="form-input"
            value={provisionDesc}
            onChange={(e) => setProvisionDesc(e.target.value)}
            placeholder={`e.g. Provision for ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`}
          />
        </div>
      </div>

      {/* Section 3: Generate */}
      <div className="card">
        <div className="section-header">
          <span className="section-badge">3</span>
          Generate Journal Entry
        </div>
        <p className="section-hint">
          Complete the sections above, then click Generate. Fields marked{' '}
          <span style={{ color: 'var(--err)' }}>*</span> are required.
        </p>
        <button className="btn btn-primary btn-full" onClick={handleGenerate} disabled={loading}>
          <span className="material-icons-round">auto_awesome</span>
          Generate Journal Entry
        </button>
      </div>
    </div>
  )
}
