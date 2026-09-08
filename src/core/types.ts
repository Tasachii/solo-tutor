export type ISODate = string // เก็บ ค.ศ. "2025-09-02" แสดง พ.ศ. ผ่าน format.ts
export type Money = number // บาท จำนวนเต็ม

export type BillingMode =
  | { mode: 'per_unit'; rate: Money }
  | { mode: 'flat_monthly'; amount: Money; /** เริ่มใช้เงื่อนไขเหมานี้วันไหน; ข้อมูลเก่า fallback เป็น createdAt */ effectiveFrom?: ISODate }
  | { mode: 'package'; total: number; price: Money; purchasedAt: ISODate // used = derive จาก completions
      /** สิทธิ์คงเหลือจากแพ็กก่อนหน้า แยกจากจำนวนที่ซื้อรอบนี้เพื่อไม่ให้ยอดบิลพอง */
      carriedCredits?: number
      /** unitId ที่แพ็กก่อนหน้านับไปแล้ว — กันคาบวันต่อแพ็กถูกคิดเงินสองรอบ */
      carriedUnitIds?: string[] }

export interface Client { id: string; name: string; lineId?: string; phone?: string }
export interface Subject {
  id: string; name: string; clientId: string; billing: BillingMode
  label?: string; active: boolean; createdAt: ISODate
  /** วันที่หยุดให้บริการ ใช้ปิดช่วงเหมาเดือนในอนาคต; ข้อมูลเก่าอาจไม่มีค่านี้ */
  inactiveAt?: ISODate
  /** Immutable service spans preserve stopped months across later reactivation. */
  billingIntervals?: { from: ISODate; to?: ISODate }[]
}
export interface ServiceUnit {
  id: string; subjectId: string; scheduledAt: ISODate; time: string
  durationMin: number; label?: string; adHoc?: boolean
  /** ยกเลิกแล้ว — ไม่โผล่ในตาราง ไม่ถูกนับเงิน แต่ยังอยู่ในประวัติ */
  cancelled?: boolean
  /** วันเดิมก่อนเลื่อน เก็บไว้ให้ตรวจย้อนได้ */
  movedFrom?: ISODate
}
export interface CompletionEvent {
  unitId: string; completedAt: ISODate; note?: string
  /** ราคาที่ตกลงไว้ตอนยืนยันงาน ป้องกันการแก้ราคาใหม่ย้อนกลับไปเปลี่ยนงานเดิม */
  unitPrice?: Money
}
export interface InvoiceLine { description: string; qty: number; unitPrice: Money; amount: Money }
export interface Invoice {
  id: string; clientId: string; subjectId: string; period: string; kind: 'monthly' | 'package'
  lines: InvoiceLine[]; total: Money; status: 'draft' | 'sent' | 'paid' | 'overdue'
  createdAt: ISODate; sentAt?: ISODate; dueAt?: ISODate
}
export interface Payment {
  id: string; invoiceId: string; amount: Money; paidAt: ISODate
  slipVerified: boolean; slipAmount?: Money
}
export interface ReceiptSnapshot {
  provider: string; destination: string; payer: string; subject: string; period: string
  lines: InvoiceLine[]; total: Money; paid: Money; slipVerified: boolean
  slipAmount?: Money; legacyBackfill?: true
}
export interface Receipt { id: string; paymentId: string; number: string; issuedAt: ISODate; snapshot: ReceiptSnapshot }

export type MessageKind = 'invoice' | 'reminder' | 'renewal' | 'renewal_exhausted' | 'receipt' | 'faq_reply'
  | 'moved' | 'cancelled' | 'summary'
  /** ทวงสั้นที่ครูกดเองจากแท็บทวงเงิน — สร้างได้วันละใบต่อบิล */
  | 'nudge'
  /** มอบหมายการบ้าน (ครูพิมพ์เนื้อหา) และทวงการบ้านที่เลยกำหนดยังไม่ส่ง */
  | 'homework' | 'homework_reminder'
/**
 * การบ้านที่มอบหมาย — เก็บใน ledger เพื่อให้ "ทวงการบ้าน" derive จากข้อมูลจริง
 * ไม่มีเงิน ไม่แตะบิล; ลบเมื่อลบนักเรียน
 */
export interface HomeworkItem {
  id: string; subjectId: string; clientId: string; text: string
  assignedAt: ISODate; dueAt: ISODate
  /** ครูทำเครื่องหมายว่าได้รับแล้ว — ร่างทวงถอนตัวเอง */
  submittedAt?: ISODate
}
export interface OaDelivery {
  providerId: string; workspaceId: string; recipientId: string; dedupeKey: string; body: string
}
export interface Message {
  id: string; clientId: string; subjectId?: string; kind: MessageKind; draft: string; edited?: boolean
  status: 'draft' | 'sent' | 'skipped'; createdAt: ISODate; sentAt?: ISODate
  dedupeKey: string; meta?: Record<string, unknown>
  /** Durable intent written before enqueue; freezes the payload until remote settlement. */
  oaDelivery?: OaDelivery
}
export interface ChatTurn {
  id: string; clientId: string; from: 'client' | 'provider'; text: string; at: ISODate; viaAdmin?: boolean
}
export interface WaitlistEntry {
  professionId: string; name: string; contact: string
  size?: string; modes?: string[]; concierge?: boolean; at: ISODate
}
export interface EventLog { at: string; name: string; props?: Record<string, unknown> }

/** demo = ข้อมูลสมมติ วันล็อก · real = ข้อมูลจริงของผู้ใช้ วันตามเครื่อง */
export type AppMode = 'demo' | 'real'

export interface AppState {
  schemaVersion: 5
  /** เพิ่มทีละครั้งเมื่อ commit ลง storage สำเร็จ ใช้ตรวจ writer รุ่นเก่าหรือข้อมูล stale */
  revision: number
  /** Stable ledger identity, retained in backups and discarded when starting a new ledger. */
  lineWorkspaceId?: string
  lineProviderId?: string
  mode: AppMode
  professionId: string
  scenarioId: string
  provider: { name: string; promptpayId: string; particle?: Particle }
  today: ISODate // เดโมล็อกวันไว้ · โหมดจริงเดินตามเครื่อง
  clients: Client[]; subjects: Subject[]; units: ServiceUnit[]; completions: CompletionEvent[]
  invoices: Invoice[]; payments: Payment[]; receipts: Receipt[]; messages: Message[]; chats: ChatTurn[]
  waitlist: WaitlistEntry[]; events: EventLog[]
  /** การบ้านที่มอบหมาย — ไม่มี = ยังไม่เคยใช้ (ไฟล์สำรอง/ข้อมูลเก่าเปิดได้เหมือนเดิม) */
  homework?: HomeworkItem[]
  counters: { receipt: number; invoice: number }
  onboarded: boolean
  /** วิธีเก็บเงินหลักที่เลือกตอนเข้าใช้ — เรื่องหน้าจอ ไม่แตะ ledger · ไม่ตั้ง = ผสม */
  style?: WorkStyle
  /** วันที่สำรองข้อมูลล่าสุด — เตือนครูเมื่อทิ้งช่วงนาน */
  lastBackupAt?: ISODate
  /**
   * ข้อความที่เปิด LINE ไปแล้วและรอยืนยัน + คิวที่เหลือ
   * ต้องอยู่ใน state ไม่ใช่ในคอมโพเนนต์ — สลับไป LINE แล้ว iOS ทิ้งแท็บได้
   * กลับมาแล้วต้องรู้ว่าค้างอยู่ที่ใคร ไม่งั้นครูส่งซ้ำและผู้ปกครองได้บิลสองรอบ
   */
  sending?: { awaiting: string; queue: string[] }
}

/** คำลงท้ายที่ครูเลือก — ไม่ตั้งค่า = ครับ (ข้อมูลเก่าและเดโม) */
export type Particle = 'ครับ' | 'ค่ะ'

/** รูปแบบการเก็บเงินหลัก — ตรงกับ BillingMode บวก 'mixed' */
export type WorkStyle = BillingMode['mode'] | 'mixed'
