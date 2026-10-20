import type { AccessRole } from './permissions';
export type Mode = 'device' | 'demo' | 'server';
export type PaymentMethod = 'cash' | 'bkash' | 'nagad' | 'rocket' | 'upay' | 'upi' | 'bank' | 'other';
export interface FinancialTransaction { id: string; amount: number; direction: 'in' | 'out'; method: PaymentMethod; reference: string; party: string; occurredAt: string; business: boolean; source: 'sms' | 'manual'; note: string; linkedSaleId?: string; currency?: 'BDT' | 'INR'; }
export interface Product { id: string; name: string; category: string; unit: string; description: string; quantity: number; cost: number; price: number; lowAt: number; source: 'manual' | 'photo'; createdAt: string; updatedAt: string; }
export interface Sale { id: string; items: { productId: string; name: string; quantity: number; price: number; cost: number }[]; total: number; profit: number; method: PaymentMethod; transactionId?: string; channel: 'shop' | 'facebook' | 'website'; customer: string; createdAt: string; requestId: string; }
export type PaymentStatus = 'waiting' | 'wrong_amount' | 'duplicate' | 'verified' | 'manual' | 'rejected';
export interface Payment { id: string; customer: string; order: string; channel: string; amount: number; received: number | null; trxId: string; status: PaymentStatus; createdAt: string; note: string; }
export interface Offer { id: string; bankId: string; bank: string; name: string; kind: 'loan' | 'grant'; amount: number; annualRate: number; months: number; requirements: string; createdAt: string; }
export interface Activity { id: string; title: string; detail: string; createdAt: string; }
export interface Shop { name: string; owner: string; location: string; phone: string; bkash: string; language: 'en' | 'bn'; shareScore: boolean; createdAt: string; }
export interface Workspace { version: number; shop: Shop; products: Product[]; sales: Sale[]; payments: Payment[]; offers: Offer[]; activity: Activity[]; processedRequests: string[]; transactions?: FinancialTransaction[]; transactionImports?: { id: string; referenceKey: string; fingerprint: string }[]; }
export type Action =
 | { type: 'product.save'; create?: true; product: Omit<Product, 'id' | 'createdAt' | 'updatedAt'> & { id?: string } }
 | { type: 'product.delete'; id: string }
 | { type: 'sale.create'; items: {productId: string; quantity: number}[]; method: Sale['method']; channel: Sale['channel']; customer: string; requestId: string; transactionId?: string }
 | { type: 'transaction.import'; transactions: Omit<FinancialTransaction, 'linkedSaleId'>[]; requestId: string }
 | { type: 'transaction.classify'; id: string; business: boolean }
 | { type: 'transaction.delete'; id: string }
 | { type: 'payment.create'; id?: string; customer: string; order: string; channel: string; amount: number; trxId: string; requestId: string }
 | { type: 'payment.review'; id: string; decision: 'manual' | 'rejected'; received?: number; note: string }
 | { type: 'shop.update'; shop: Partial<Omit<Shop, 'createdAt'>> };
/** role is the account type (shop owner or bank user); accessRole is the permission level. */
export interface User { id: string; email: string; role: 'merchant' | 'bank'; name?: string; accessRole?: AccessRole; emailVerified?: boolean; }
export interface Session { user: User; token?: string; }
export interface Score { value: number | null; label: string; days: number; digital: number; consistency: number; turnover: number; reasons: {title: string; detail: string; value: string; good: boolean}[]; }
export interface Dashboard { todaySales: number; todayCount: number; cash: number; bkash: number; stockValue: number; totalProducts: number; lowProducts: Product[]; reviewPayments: Payment[]; monthSales: number; monthCount: number; profit: number; digital: number; daily: {date: string; value: number}[]; }
export interface BusinessProfile { id: string; name: string; owner: string; location: string; score: Score; monthlySales: number; digital: number; months: number; stockValue: number; history: {date: string; value: number}[]; }
