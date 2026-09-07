import { useParams } from 'react-router-dom'
import { readDocument } from '../core/documents'
import { dateThai, money, periodThai } from '../core/format'
import { PromptPayQR } from './components'
import { copy } from '../copy'

/** Mounted outside StoreProvider: recipient never loads, modifies or inherits a workspace. */
export default function SharedDocument() {
  const { token = '' } = useParams()
  const d = readDocument(token)
  if (!d) return <main className="page"><h1 className="h1">เปิดเอกสารไม่ได้</h1><p>ลิงก์ไม่ครบหรือข้อมูลไม่ถูกต้อง กรุณาขอลิงก์ใหม่จากผู้ส่ง</p></main>
  const balance = d.total - d.paid
  return <main className="page page--paper">
    <p className="hint no-print">สำเนาข้อมูล ณ {dateThai(d.asOf)} · ยอดในลิงก์นี้ไม่อัปเดตอัตโนมัติ</p>
    <article className="paper">
      <header className="paper__hd"><h1 className="paper__h1">{d.kind === 'receipt' ? 'ใบเสร็จรับเงิน' : 'ใบแจ้งยอด'}</h1>{d.number && <b>{d.number}</b>}</header>
      <dl className="paper__meta">
        <div><dt>ผู้รับเงิน</dt><dd>{d.provider}</dd></div>
        <div><dt>ผู้จ่าย</dt><dd>{d.payer} ({d.subject})</dd></div>
        <div><dt>เดือน</dt><dd>{periodThai(d.period)}</dd></div>
        <div><dt>วันที่เอกสาร</dt><dd>{dateThai(d.asOf)}</dd></div>
        {d.dueAt && <div><dt>ครบกำหนด</dt><dd>{dateThai(d.dueAt)}</dd></div>}
      </dl>
      <table className="paper__tbl"><thead><tr><th>รายการ</th><th className="r">บาท</th></tr></thead>
        <tbody>{d.lines.map((l, i) => <tr key={i}><td>{l.description}</td><td className="r num">{money(l.amount)}</td></tr>)}</tbody>
        <tfoot><tr><td>ยอดรวม</td><td className="r num">{money(d.total)}</td></tr></tfoot>
      </table>
      <p>รับชำระแล้ว <b className="num">{money(d.paid)} บาท</b></p>
      <p>คงเหลือ <b className="num">{money(balance)} บาท</b></p>
      {balance > 0 && <div className="card">
        {/* ลิงก์นี้คือสิ่งที่ผู้ปกครองได้รับจริง — สแกนจากตรงนี้ได้เลยถ้าปลายทางใช้ได้ */}
        {d.destination && <PromptPayQR destination={d.destination} amount={balance}
          label={copy.clientView.scanToPay} sub={copy.clientView.scanAmount.replace('{n}', money(balance))} />}
        <p>โอนผ่านพร้อมเพย์</p><strong>{d.destination || 'กรุณาติดต่อผู้ส่งเพื่อขอข้อมูลชำระเงิน'}</strong><p className="hint">ตรวจชื่อผู้รับในแอปธนาคารให้ตรงกับผู้ให้บริการก่อนยืนยันโอน</p></div>}
      <p className="paper__fine">สำเนาที่ผู้ส่งจัดทำ · Solo Tutor ไม่ได้รับรองลายเซ็นหรือยืนยันการโอนเงิน ติดต่อผู้ส่งเพื่อตรวจสอบยอดล่าสุด</p>
    </article>
    <p className="hint no-print">ลิงก์นี้มีข้อมูลของคุณ ผู้ที่ได้รับลิงก์สามารถเปิดอ่านได้</p>
    <button className="btn btn--primary no-print" onClick={() => window.print()}>พิมพ์ / บันทึก PDF</button>
  </main>
}
