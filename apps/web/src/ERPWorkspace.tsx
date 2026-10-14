import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Receipt, Plus, RefreshCw } from 'lucide-react';

type InvoiceStatus = 'DRAFT' | 'SENT' | 'PAID' | 'OVERDUE' | 'CANCELLED';
type ExpenseStatus = 'PENDING' | 'APPROVED' | 'PAID';
type Invoice = { id:string; invoiceNumber:string; customerName:string; amountCents:number; status:InvoiceStatus; issueDate:string; dueDate:string|null; notes:string|null };
type Expense = { id:string; title:string; vendor:string|null; category:string; amountCents:number; status:ExpenseStatus; incurredAt:string; notes:string|null };
type Props = { organizationId:string; role:string };
const invoiceStatuses:InvoiceStatus[]=['DRAFT','SENT','PAID','OVERDUE','CANCELLED'];
const expenseStatuses:ExpenseStatus[]=['PENDING','APPROVED','PAID'];
const money=(cents:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(cents/100);
const date=(value:string|null)=>value?new Date(value).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}):'—';

export default function ERPWorkspace({organizationId,role}:Props){
 const canWrite=['OWNER','ADMIN','MEMBER'].includes(role);
 const [tab,setTab]=useState<'invoices'|'expenses'>('invoices');
 const [invoices,setInvoices]=useState<Invoice[]>([]); const [expenses,setExpenses]=useState<Expense[]>([]);
 const [loading,setLoading]=useState(true); const [saving,setSaving]=useState(false); const [error,setError]=useState(''); const [notice,setNotice]=useState('');
 const [formOpen,setFormOpen]=useState(false); const [search,setSearch]=useState('');
 const [invoice,setInvoice]=useState({invoiceNumber:'',customerName:'',amount:'',dueDate:'',notes:''});
 const [expense,setExpense]=useState({title:'',vendor:'',category:'General',amount:'',incurredAt:new Date().toISOString().slice(0,10),notes:''});
 const load=useCallback(async()=>{setLoading(true);setError('');try{
  const [ir,er]=await Promise.all(['invoices','expenses'].map(p=>fetch('/api/organizations/'+organizationId+'/erp/'+p,{credentials:'include'})));
  const [ib,eb]=await Promise.all([ir.json(),er.json()]);
  if(!ir.ok)throw new Error(ib.error??'Unable to load invoices'); if(!er.ok)throw new Error(eb.error??'Unable to load expenses');
  setInvoices(ib.invoices);setExpenses(eb.expenses);
 }catch(e){setError(e instanceof Error?e.message:'Unable to load ERP records')}finally{setLoading(false)}},[organizationId]);
 useEffect(()=>{void load()},[load]);
 async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setSaving(true);setError('');setNotice('');try{
  const isInvoice=tab==='invoices';
  const payload=isInvoice?{...invoice,amount:Number(invoice.amount)}:{...expense,amount:Number(expense.amount)};
  const r=await fetch('/api/organizations/'+organizationId+'/erp/'+(isInvoice?'invoices':'expenses'),{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const b=await r.json();if(!r.ok)throw new Error(b.error??'Unable to save record');
  setFormOpen(false);setInvoice({invoiceNumber:'',customerName:'',amount:'',dueDate:'',notes:''});setExpense({title:'',vendor:'',category:'General',amount:'',incurredAt:new Date().toISOString().slice(0,10),notes:''});
  setNotice(isInvoice?'Invoice created.':'Expense recorded.');await load();
 }catch(e){setError(e instanceof Error?e.message:'Unable to save record')}finally{setSaving(false)}}
 async function changeStatus(id:string,status:string){setError('');try{const r=await fetch('/api/organizations/'+organizationId+'/erp/'+(tab==='invoices'?'invoices':'expenses')+'/'+id+'/status',{method:'PATCH',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({status})});const b=await r.json();if(!r.ok)throw new Error(b.error??'Unable to update status');setNotice('Status updated.');await load()}catch(e){setError(e instanceof Error?e.message:'Unable to update status')}}
 const filteredInvoices=useMemo(()=>invoices.filter(x=>(x.invoiceNumber+' '+x.customerName+' '+x.status).toLowerCase().includes(search.toLowerCase())),[invoices,search]);
 const filteredExpenses=useMemo(()=>expenses.filter(x=>(x.title+' '+(x.vendor??'')+' '+x.category+' '+x.status).toLowerCase().includes(search.toLowerCase())),[expenses,search]);
 const invoiced=invoices.filter(x=>x.status!=='CANCELLED').reduce((n,x)=>n+x.amountCents,0),paid=invoices.filter(x=>x.status==='PAID').reduce((n,x)=>n+x.amountCents,0),expenseTotal=expenses.reduce((n,x)=>n+x.amountCents,0);
 return <section className="erp-workspace">
  <header className="erp-heading"><div><div className="crm-eyebrow">OPERATIONS & FINANCE</div><h1>ERP · Finance</h1><p>Track customer invoices and keep business expenses organized.</p></div><button className="crm-refresh" onClick={()=>void load()} disabled={loading}><RefreshCw size={14}/> Refresh</button></header>
  <div className="erp-stats"><article className="crm-stat"><small>Invoices issued</small><strong>{money(invoiced)}</strong><span>{invoices.length} invoice records</span></article><article className="crm-stat"><small>Payments received</small><strong>{money(paid)}</strong><span>Marked as paid</span></article><article className="crm-stat"><small>Expenses recorded</small><strong>{money(expenseTotal)}</strong><span>{expenses.length} expense records</span></article></div>
  {error&&<div className="auth-error crm-alert" role="alert">{error}</div>}{notice&&<div className="hr-success" role="status">{notice}</div>}
  <div className="crm-panel erp-panel"><div className="crm-toolbar"><div className="crm-tabs" role="tablist" aria-label="Finance sections"><button className={tab==='invoices'?'selected':''} onClick={()=>{setTab('invoices');setSearch('');setFormOpen(false)}}><FileText size={14}/> Invoices <span>{invoices.length}</span></button><button className={tab==='expenses'?'selected':''} onClick={()=>{setTab('expenses');setSearch('');setFormOpen(false)}}><Receipt size={14}/> Expenses <span>{expenses.length}</span></button></div><div className="crm-tools"><input className="erp-search" aria-label="Search finance records" placeholder="Search records…" value={search} onChange={e=>setSearch(e.target.value)}/>{canWrite&&<button className="crm-primary" onClick={()=>{setError('');setNotice('');setFormOpen(v=>!v)}}><Plus size={14}/>{tab==='invoices'?'New invoice':'Add expense'}</button>}</div></div>
  {formOpen&&<form className="crm-form erp-form" onSubmit={e=>void submit(e)}><h3>{tab==='invoices'?'Create invoice':'Record expense'}</h3>{tab==='invoices'?<>
   <label>Invoice number *<input required maxLength={50} value={invoice.invoiceNumber} onChange={e=>setInvoice({...invoice,invoiceNumber:e.target.value})}/></label><label>Customer name *<input required maxLength={120} value={invoice.customerName} onChange={e=>setInvoice({...invoice,customerName:e.target.value})}/></label><label>Amount (INR) *<input required type="number" min="0.01" step="0.01" max="21000000" value={invoice.amount} onChange={e=>setInvoice({...invoice,amount:e.target.value})}/></label><label>Due date<input type="date" value={invoice.dueDate} onChange={e=>setInvoice({...invoice,dueDate:e.target.value})}/></label><label className="erp-wide">Notes<textarea maxLength={2000} rows={2} value={invoice.notes} onChange={e=>setInvoice({...invoice,notes:e.target.value})}/></label>
  </>:<>
   <label>Expense title *<input required maxLength={140} value={expense.title} onChange={e=>setExpense({...expense,title:e.target.value})}/></label><label>Vendor<input maxLength={120} value={expense.vendor} onChange={e=>setExpense({...expense,vendor:e.target.value})}/></label><label>Category *<input required maxLength={80} value={expense.category} onChange={e=>setExpense({...expense,category:e.target.value})}/></label><label>Amount (INR) *<input required type="number" min="0.01" step="0.01" max="21000000" value={expense.amount} onChange={e=>setExpense({...expense,amount:e.target.value})}/></label><label>Date *<input required type="date" value={expense.incurredAt} onChange={e=>setExpense({...expense,incurredAt:e.target.value})}/></label><label className="erp-wide">Notes<textarea maxLength={2000} rows={2} value={expense.notes} onChange={e=>setExpense({...expense,notes:e.target.value})}/></label>
  </>}<div className="crm-form-actions"><button type="button" onClick={()=>setFormOpen(false)}>Cancel</button><button type="submit" disabled={saving}>{saving?'Saving…':'Save record'}</button></div></form>}
  {loading?<div className="crm-empty">Loading finance records…</div>:tab==='invoices'?filteredInvoices.length?<div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Invoice</th><th>Customer</th><th>Issue date</th><th>Due date</th><th>Amount</th><th>Status</th></tr></thead><tbody>{filteredInvoices.map(x=><tr key={x.id}><td><strong>{x.invoiceNumber}</strong></td><td>{x.customerName}</td><td>{date(x.issueDate)}</td><td>{date(x.dueDate)}</td><td>{money(x.amountCents)}</td><td><select className="erp-status" aria-label={'Status for '+x.invoiceNumber} value={x.status} disabled={!canWrite} onChange={e=>void changeStatus(x.id,e.target.value)}>{invoiceStatuses.map(s=><option key={s} value={s}>{s}</option>)}</select></td></tr>)}</tbody></table></div>:<div className="crm-empty">No invoices yet. Create your first invoice to start tracking receivables.</div>:filteredExpenses.length?<div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Expense</th><th>Vendor / category</th><th>Date</th><th>Amount</th><th>Status</th></tr></thead><tbody>{filteredExpenses.map(x=><tr key={x.id}><td><strong>{x.title}</strong></td><td>{x.vendor??'—'}<div className="erp-muted">{x.category}</div></td><td>{date(x.incurredAt)}</td><td>{money(x.amountCents)}</td><td><select className="erp-status" aria-label={'Status for '+x.title} value={x.status} disabled={!canWrite} onChange={e=>void changeStatus(x.id,e.target.value)}>{expenseStatuses.map(s=><option key={s} value={s}>{s}</option>)}</select></td></tr>)}</tbody></table></div>:<div className="crm-empty">No expenses yet. Add a business expense to start tracking costs.</div>}
  </div>
  <p className="erp-footnote">Amounts are recorded in INR. This milestone does not yet generate downloadable invoices or connect to payment providers.</p>
 </section>;
}
