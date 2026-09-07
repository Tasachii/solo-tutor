import { useState } from 'react'
import { useStore, SCHEMA } from '../core/store'
import { download } from '../core/export'
import { pickBackup, saveBackup } from './backup'

export default function StorageStatus() {
  const { state, dispatch, persistenceError, recoveryRaw, didReset, writeStatus, retryPersistence } = useStore()
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  if (!persistenceError && writeStatus === 'writable') return null
  const statusMessage = persistenceError
    ?? (writeStatus === 'acquiring'
      ? 'กำลังรอสิทธิ์แก้ไขข้อมูล แท็บอื่นอาจกำลังใช้งานอยู่ หน้านี้ยังดูและสำรองข้อมูลได้'
      : writeStatus === 'readonly'
        ? 'เบราว์เซอร์นี้เปิดข้อมูลให้อ่านได้ แต่ไม่รองรับการล็อกที่จำเป็นสำหรับการบันทึกอย่างปลอดภัย'
        : writeStatus === 'conflict'
          ? 'ข้อมูลในแท็บนี้เก่ากว่าข้อมูลที่บันทึกล่าสุด ระบบหยุดการเขียนเพื่อป้องกันข้อมูลหาย'
          : 'ยังเปิดสิทธิ์บันทึกข้อมูลไม่ได้')
  return <section role={writeStatus === 'acquiring' ? 'status' : 'alert'} className="card" style={{ margin: '12px', border: '2px solid var(--danger)' }}>
    <h2 className="h2">{didReset ? 'ข้อมูลเดิมต้องกู้คืน' : writeStatus === 'acquiring' ? 'กำลังรอสิทธิ์แก้ไข' : 'ยังแก้ไขข้อมูลไม่ได้'}</h2>
    <p>{statusMessage}</p>
    <div className="btnrow">
      {recoveryRaw !== null
        ? <button className="btn btn--secondary" onClick={() => download(recoveryRaw, 'solo-recovery-raw.json', 'application/json')}>เก็บสำเนาข้อมูลเดิม</button>
        : !didReset && <button className="btn btn--secondary" onClick={async () => {
          const saved = await saveBackup(state)
          setNotice(saved ? 'เปิดหน้าต่างบันทึกไฟล์สำรองแล้ว' : '')
          setActionError(saved ? '' : 'ยังบันทึกไฟล์สำรองไม่สำเร็จ กรุณาลองผ่านเบราว์เซอร์อื่น')
        }}>สำรองข้อมูลที่บันทึกแล้ว</button>}
      {didReset && <button className="btn btn--primary" onClick={async () => {
        const result = await pickBackup(SCHEMA)
        if (!result) return
        if (result.ok) {
          if (!dispatch({ type: 'restore', state: result.state })) setActionError('อ่านไฟล์ได้ แต่บันทึกข้อมูลที่กู้คืนไม่สำเร็จ ข้อมูลเดิมยังไม่ถูกเขียนทับ')
          return
        }
        const reason = result.reason === 'unreadable' ? 'อ่านไฟล์ไม่ได้หรือไฟล์เสียหาย'
          : result.reason === 'wrongVersion' ? 'ไฟล์มาจากเวอร์ชันที่ระบบนี้ยังไม่รองรับ'
            : 'ไฟล์นี้ไม่ใช่ไฟล์สำรองของ Solo Tutor หรือข้อมูลไม่ครบ'
        setActionError(`${reason} กรุณาเลือกไฟล์สำรอง .json ไฟล์อื่น`)
      }}>กู้คืนจากไฟล์สำรอง</button>}
      {!didReset && (writeStatus === 'conflict' || writeStatus === 'error') && (
        <button className="btn btn--primary" onClick={async () => {
          setActionError(''); setNotice('')
          const ok = await retryPersistence()
          if (!ok) setActionError('ยังเปิดสิทธิ์แก้ไขไม่ได้ อาจมีอีกแท็บกำลังใช้งานอยู่ กรุณาปิดแท็บซ้ำแล้วลองใหม่')
        }}>ลองเปิดสิทธิ์แก้ไขอีกครั้ง</button>
      )}
      <button className="btn btn--ghost" onClick={() => window.location.reload()}>โหลดข้อมูลใหม่</button>
    </div>
    {notice && <p className="hint" role="status">{notice}</p>}
    {actionError && <p className="fld__err" role="alert">{actionError}</p>}
    {didReset && <p className="hint">ข้อมูลเดิมยังอยู่ในเครื่อง และจะเก็บสำเนาแยกให้อีกครั้งก่อนกู้คืนสำเร็จ</p>}
  </section>
}
