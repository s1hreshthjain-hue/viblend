// js/payments.js — Razorpay integration scaffold for Viblend Pro tier

import CONFIG from './config.js';

// ─── Pro Features (future) ───────────────────────────────────────────────────

export const PRO_FEATURES = [
  { icon: '👥', label: 'Parties up to 8 people' },
  { icon: '📜', label: 'Unlimited queue length' },
  { icon: '🎙', label: 'Studio-quality voice processing' },
  { icon: '📊', label: 'Full party analytics & stats' },
  { icon: '🎨', label: 'Custom room themes' },
  { icon: '📤', label: 'Party recording & export' },
];

export const PRO_PLANS = [
  {
    id: 'viblend_pro_monthly',
    name: 'Monthly',
    price: 199,
    currency: 'INR',
    period: 'month',
    description: '₹199/month, cancel anytime',
  },
  {
    id: 'viblend_pro_yearly',
    name: 'Yearly',
    price: 1499,
    currency: 'INR',
    period: 'year',
    description: '₹1499/year — save 37%',
    recommended: true,
  },
];

// ─── Razorpay Loader ─────────────────────────────────────────────────────────

let razorpayLoaded = false;

async function loadRazorpay() {
  if (razorpayLoaded || window.Razorpay) { razorpayLoaded = true; return; }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => { razorpayLoaded = true; resolve(); };
    script.onerror = () => reject(new Error('Razorpay failed to load'));
    document.head.appendChild(script);
  });
}

// ─── Initiate Payment ─────────────────────────────────────────────────────────

export async function initiateProUpgrade(planId, userSession) {
  if (!CONFIG.RAZORPAY_KEY_ID || CONFIG.RAZORPAY_KEY_ID.includes('PLACEHOLDER')) {
    console.warn('Razorpay not configured — payments scaffold only');
    showProComingSoon();
    return;
  }

  const plan = PRO_PLANS.find(p => p.id === planId);
  if (!plan) throw new Error(`Unknown plan: ${planId}`);

  await loadRazorpay();

  // In production: create order on backend first, use order_id here
  // For scaffold: using plan amount directly
  const options = {
    key: CONFIG.RAZORPAY_KEY_ID,
    amount: plan.price * 100, // paise
    currency: plan.currency,
    name: 'Viblend',
    description: `Viblend Pro — ${plan.name}`,
    image: '/icons/icon-192.png',
    prefill: {
      name: userSession?.displayName || '',
      email: '',
      contact: '',
    },
    theme: {
      color: '#5B4DDE',
      backdrop_color: '#0F0E1A',
    },
    modal: {
      ondismiss: () => {
        console.log('Razorpay modal dismissed');
      },
    },
    handler: (response) => handlePaymentSuccess(response, plan),
  };

  const rzp = new window.Razorpay(options);
  rzp.on('payment.failed', handlePaymentFailed);
  rzp.open();
}

function handlePaymentSuccess(response, plan) {
  // response.razorpay_payment_id
  // response.razorpay_order_id
  // response.razorpay_signature
  // In production: verify signature on backend
  console.log('Payment successful:', response);
  window.dispatchEvent(new CustomEvent('viblend:pro-activated', { detail: { plan, response } }));
}

function handlePaymentFailed(response) {
  console.error('Payment failed:', response.error);
  window.dispatchEvent(new CustomEvent('viblend:payment-failed', { detail: response.error }));
}

function showProComingSoon() {
  window.dispatchEvent(new CustomEvent('viblend:toast', {
    detail: { message: 'Viblend Pro coming soon! 🚀', type: 'info', duration: 3000 }
  }));
}

// ─── Pro Paywall UI ────────────────────────────────────────────────────────── 

export function renderProPaywall(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <div style="padding:24px 20px;background:var(--bg-secondary);border-radius:var(--radius-xl);max-width:380px;margin:0 auto">
      <div style="text-align:center;margin-bottom:24px">
        <div style="font-size:36px;margin-bottom:8px">⚡</div>
        <div style="font-size:22px;font-weight:700;margin-bottom:6px">Viblend Pro</div>
        <div style="font-size:14px;color:var(--text-secondary)">Unlock the full party experience</div>
      </div>

      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:24px">
        ${PRO_FEATURES.map(f => `
          <div style="display:flex;align-items:center;gap:12px;font-size:14px">
            <span style="font-size:20px">${f.icon}</span>
            <span>${f.label}</span>
          </div>
        `).join('')}
      </div>

      <div style="display:flex;gap:10px;margin-bottom:16px">
        ${PRO_PLANS.map(p => `
          <button onclick="window.viblendPayments?.upgrade('${p.id}')"
            style="flex:1;padding:14px 8px;border-radius:var(--radius-md);border:${p.recommended ? '2px solid var(--violet)' : '1px solid var(--border-medium)'};
            background:${p.recommended ? 'rgba(91,77,222,0.12)' : 'var(--bg-card)'};cursor:pointer;color:var(--text-primary);
            font-family:var(--font);text-align:center">
            <div style="font-size:13px;font-weight:700;margin-bottom:4px">${p.name}</div>
            <div style="font-size:18px;font-weight:700;color:var(--violet)">₹${p.price}</div>
            <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px">/${p.period}</div>
            ${p.recommended ? '<div style="font-size:10px;color:var(--violet);font-weight:700;margin-top:4px">BEST VALUE</div>' : ''}
          </button>
        `).join('')}
      </div>

      <div style="font-size:11px;color:var(--text-tertiary);text-align:center;line-height:1.6">
        Secure payment via Razorpay · Cancel anytime<br />
        All prices include GST
      </div>
    </div>
  `;
}

// ─── Global access ────────────────────────────────────────────────────────────

window.viblendPayments = {
  upgrade: (planId) => initiateProUpgrade(planId, window.viblendSession),
  renderPaywall: renderProPaywall,
};
