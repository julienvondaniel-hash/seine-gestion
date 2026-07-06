import React, { useState, useMemo, useEffect } from "react";
import {
  LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip,
  PieChart, Pie, Cell, AreaChart, Area, ReferenceLine, BarChart, Bar,
} from "recharts";
import {
  Phone, Mail, TrendingUp, Home, Briefcase, AlertTriangle,
  Calculator, ChevronRight, Shield, Droplet, Layers, Wallet,
  Plus, Trash2, X, Pencil, Lock, PiggyBank,
} from "lucide-react";
import { listAssets, upsertAsset, deleteAsset, saveSciSimulation, recordNetWorthSnapshot, listNetWorthHistory, deleteNetWorthSnapshot } from "../lib/data";
import MesDonnees from "./MesDonnees.jsx";
import Logo from "./Logo.jsx";
import Hex from "./Hex.jsx";
import { useTheme, SERIF } from "../lib/theme.jsx";

const CABINET = { name: "Mon Kap Pat", tel: "0658803630", telDisplay: "06 58 80 36 30", email: "j.daniel@hexa-patrimoine.com" };

/* ------------------------------------------------------------------ */
/*  Design tokens — univers family office                              */
/* ------------------------------------------------------------------ */
// Couleurs et PIE viennent désormais du thème (useTheme), par composant.
const inputStyle = (C) => ({ background: C.ink, border: `1px solid ${C.line}`, borderRadius: 10, padding: "11px 12px", color: C.ivory, fontSize: 14, width: "100%", boxSizing: "border-box" });


const fmt = (n) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n || 0);
const fmtPct = (n) => `${n > 0 ? "+" : ""}${n.toFixed(1)} %`;

const CATEGORIES = {
  mobilier: [
    { key: "Actions", label: "Actions / ETF", liquid: true, market: true },
    { key: "Obligations", label: "Obligations / fonds €", liquid: true, market: false },
    { key: "Private equity", label: "Private equity / non coté", liquid: false, market: true },
    { key: "Liquidités", label: "Liquidités / livrets", liquid: true, market: false },
    { key: "Métaux précieux", label: "Métaux précieux (or, argent)", liquid: true, market: true },
    { key: "Autre mobilier", label: "Autre (crypto…)", liquid: true, market: true },
  ],
  immobilier: [
    { key: "Résidence principale", label: "Résidence principale", liquid: false, market: false },
    { key: "Locatif", label: "Immobilier locatif", liquid: false, market: false },
    { key: "SCPI", label: "SCPI / pierre-papier", liquid: false, market: false },
  ],
};
const ALL_CATS = [...CATEGORIES.mobilier, ...CATEGORIES.immobilier];
const catMeta = (key) => ALL_CATS.find((c) => c.key === key) || { liquid: true, market: false };



/* ------------------------------------------------------------------ */
/*  Moteur TRI — XIRR générique sur flux annuels                       */
/* ------------------------------------------------------------------ */
function irrFromAnnual(cashflows) {
  // cashflows : tableau indexé par année (année 0 = aujourd'hui)
  const v = cashflows.filter((c) => c !== 0);
  if (v.length < 2) return null;
  if (!cashflows.some((c) => c < 0) || !cashflows.some((c) => c > 0)) return null;
  const npv = (r) => cashflows.reduce((s, c, t) => s + c / Math.pow(1 + r, t), 0);
  const dnpv = (r) => cashflows.reduce((s, c, t) => s - (t * c) / Math.pow(1 + r, t + 1), 0);
  let r = 0.08;
  for (let i = 0; i < 80; i++) {
    const d = dnpv(r); if (Math.abs(d) < 1e-10) break;
    const n = r - npv(r) / d;
    if (!isFinite(n)) { r = NaN; break; }
    if (Math.abs(n - r) < 1e-8) return n;
    r = n;
  }
  if (isFinite(r) && r > -0.9999) return r;
  let lo = -0.99, hi = 5, flo = npv(lo);
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2, fm = npv(mid);
    if (Math.abs(fm) < 0.5) return mid;
    if (flo * fm < 0) hi = mid; else { lo = mid; flo = fm; }
  }
  return null;
}

function xirr(flows) {
  const v = flows.filter((f) => f.date && !isNaN(f.amount) && f.amount !== 0)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  if (v.length < 2) return null;
  if (!v.some((f) => f.amount < 0) || !v.some((f) => f.amount > 0)) return null;
  const t0 = new Date(v[0].date).getTime();
  const yr = (d) => (new Date(d).getTime() - t0) / (365 * 24 * 3600 * 1000);
  const npv = (r) => v.reduce((s, f) => s + f.amount / Math.pow(1 + r, yr(f.date)), 0);
  const dnpv = (r) => v.reduce((s, f) => s - (yr(f.date) * f.amount) / Math.pow(1 + r, yr(f.date) + 1), 0);
  let r = 0.1;
  for (let i = 0; i < 60; i++) {
    const d = dnpv(r); if (Math.abs(d) < 1e-10) break;
    const n = r - npv(r) / d;
    if (!isFinite(n)) { r = NaN; break; }
    if (Math.abs(n - r) < 1e-7) return n;
    r = n;
  }
  if (isFinite(r) && r > -0.9999) return r;
  let lo = -0.99, hi = 10, flo = npv(lo);
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2, fm = npv(mid);
    if (Math.abs(fm) < 1) return mid;
    if (flo * fm < 0) hi = mid; else { lo = mid; flo = fm; }
  }
  return null;
}
function moic(flows) {
  const inv = flows.filter((f) => f.amount < 0).reduce((s, f) => s - f.amount, 0);
  const ret = flows.filter((f) => f.amount > 0).reduce((s, f) => s + f.amount, 0);
  return inv > 0 ? ret / inv : null;
}
function cumulative(flows) {
  const v = [...flows].filter((f) => f.date).sort((a, b) => new Date(a.date) - new Date(b.date));
  let acc = 0;
  return v.map((f) => { acc += f.amount; return { date: f.date.slice(2), cumul: acc }; });
}

/* ------------------------------------------------------------------ */
/*  MOTEUR SCI À L'IS — simulation année par année                     */
/* ------------------------------------------------------------------ */
/*
  Hypothèses du modèle (paramétrables) :
  - Acquisition d'un immeuble de rapport via SCI à l'IS.
  - Financement par crédit amortissable (mensualités constantes).
  - Loyers indexés, charges et vacance en % des loyers.
  - IS : 15 % jusqu'à 42 500 € de résultat, 25 % au-delà (barème 2026).
  - Amortissement : composant bâti (hors terrain) linéaire + mobilier.
    -> réduit le résultat fiscal, donc l'IS, mais pas la trésorerie.
  - Revente : plus-value IS = prix de vente - valeur nette comptable
    (donc réintégration des amortissements pratiqués). Pas d'abattement
    pour durée de détention à l'IS (différence majeure avec l'IR).
  - TRI calculé sur les flux de trésorerie pour l'associé :
    année 0 = apport ; années 1..N = cash-flow net après IS et crédit ;
    année N = + produit net de revente après remboursement du capital
    restant dû et IS sur plus-value.
*/
function simulateSCI(p) {
  const {
    prix, fraisActe, travaux, apport, // acquisition
    tauxCredit, dureeCredit,          // financement
    loyerAnnuel, chargesPct, vacancePct, indexation, // exploitation
    partTerrain, dureeAmortBati,      // amortissement
    appreciation, horizon, fraisVente // revente
  } = p;

  const coutTotal = prix + fraisActe + travaux;
  const montantEmprunte = Math.max(0, coutTotal - apport);
  const baseAmort = (prix * (1 - partTerrain / 100)) + travaux; // bâti + travaux amortissables
  const amortAnnuel = dureeAmortBati > 0 ? baseAmort / dureeAmortBati : 0;

  // Crédit : mensualité constante -> on raisonne en annuités
  const i = tauxCredit / 100;
  const annuite = montantEmprunte > 0 && i > 0
    ? montantEmprunte * i / (1 - Math.pow(1 + i, -dureeCredit))
    : (dureeCredit > 0 ? montantEmprunte / dureeCredit : 0);

  let crd = montantEmprunte;            // capital restant dû
  let vnc = coutTotal - (prix * partTerrain / 100); // valeur nette comptable amortissable (le terrain ne s'amortit pas mais reste à l'actif)
  let valeurBien = prix + travaux;
  const isOf = (res) => res <= 0 ? 0 : (res <= 42500 ? res * 0.15 : 42500 * 0.15 + (res - 42500) * 0.25);

  const rows = [];
  const cashflows = [-apport]; // année 0

  for (let an = 1; an <= horizon; an++) {
    const loyer = loyerAnnuel * Math.pow(1 + indexation / 100, an - 1);
    const loyerEncaisse = loyer * (1 - vacancePct / 100);
    const charges = loyer * (chargesPct / 100);

    // Décomposition de l'annuité de crédit
    const interets = crd * i;
    const capitalRembourse = Math.min(crd, Math.max(0, annuite - interets));
    crd = Math.max(0, crd - capitalRembourse);

    // Résultat fiscal (IS) : loyers - charges - intérêts - amortissement
    const amort = an <= dureeAmortBati ? amortAnnuel : 0;
    const resultatFiscal = loyerEncaisse - charges - interets - amort;
    const is = isOf(resultatFiscal);
    vnc = Math.max(0, vnc - amort);

    // Trésorerie : loyers encaissés - charges - annuité (capital+intérêts) - IS
    const annuiteVersee = an <= dureeCredit ? (interets + capitalRembourse) : 0;
    const cashflow = loyerEncaisse - charges - annuiteVersee - is;

    valeurBien = (prix + travaux) * Math.pow(1 + appreciation / 100, an);

    let revente = 0, isPV = 0, prixNet = 0, plusValue = 0;
    if (an === horizon) {
      prixNet = valeurBien * (1 - fraisVente / 100);
      plusValue = prixNet - vnc;            // PV imposable à l'IS = prix net - VNC
      isPV = isOf(plusValue);
      revente = prixNet - crd - isPV;       // produit net pour l'associé après remboursement du CRD
    }

    cashflows.push(cashflow + revente);
    rows.push({ an, loyerEncaisse, charges, interets, amort, resultatFiscal, is, cashflow, crd, valeurBien, revente, plusValue, isPV });
  }

  const tri = irrFromAnnual(cashflows);
  const cumulCash = rows.reduce((s, r) => s + r.cashflow, 0);
  const totalRevente = rows[rows.length - 1]?.revente || 0;
  const gainTotal = cumulCash + totalRevente - apport;

  return { rows, cashflows, tri, coutTotal, montantEmprunte, annuite, amortAnnuel, apport, cumulCash, totalRevente, gainTotal };
}

/* ------------------------------------------------------------------ */
/*  Analyse de risques                                                 */
/* ------------------------------------------------------------------ */
function analyse(assets) {
  const gross = assets.reduce((s, a) => s + a.value, 0);
  const net = assets.reduce((s, a) => s + a.value - (a.debt || 0), 0);
  if (gross === 0) return { gross, net, items: [] };
  const out = [];
  const pct = (x) => `${(x * 100).toFixed(0)} %`;
  const sumCat = (key) => assets.filter((a) => a.category === key).reduce((s, a) => s + a.value, 0);
  const sumType = (t) => assets.filter((a) => a.type === t).reduce((s, a) => s + a.value, 0);

  // Concentration immobilière — sensibilité à une remontée des taux.
  const immo = sumType("immobilier") / gross;
  if (immo > 0.25)
    out.push({ icon: Home, level: "warn", title: "Concentration immobilière",
      text: `L'immobilier représente ${pct(immo)} de votre patrimoine. Attention au risque de baisse en cas de remontée des taux.` });

  // Exposition obligataire — même sensibilité aux taux.
  const oblig = sumCat("Obligations") / gross;
  if (oblig > 0.25)
    out.push({ icon: TrendingUp, level: "warn", title: "Exposition obligataire",
      text: `Les obligations / fonds € représentent ${pct(oblig)} du patrimoine. Attention au risque de baisse en cas de remontée des taux.` });

  // Liquidités dormantes — trop de cash non investi.
  const cash = sumCat("Liquidités");
  if (cash > 30000 && cash / gross > 0.10)
    out.push({ icon: Droplet, level: "warn", title: "Trop de liquidités",
      text: `Vous détenez ${fmt(cash)} de liquidités (${pct(cash / gross)} du patrimoine). Vous avez trop de cash : votre argent n'est pas assez au travail.` });

  // Sous-exposition aux métaux précieux — diversification / protection inflation.
  const metaux = sumCat("Métaux précieux");
  if (metaux / gross < 0.05)
    out.push({ icon: Layers, level: "warn", title: "Métaux précieux",
      text: metaux === 0
        ? `Absence de métaux (or, argent) dans votre portefeuille. Une poche de métaux précieux peut diversifier et protéger en cas d'inflation.`
        : `Les métaux précieux représentent moins de 5 % (${pct(metaux / gross)}). Une exposition un peu plus élevée renforcerait la diversification.` });

  // Endettement — effet de levier.
  const debt = assets.reduce((s, a) => s + (a.debt || 0), 0);
  const ltv = debt / gross;
  if (ltv > 0.5)
    out.push({ icon: AlertTriangle, level: "alert", title: "Endettement",
      text: `Le ratio dette / actifs atteint ${pct(ltv)}. Un effet de levier élevé amplifie les variations de votre valeur nette.` });

  // Note positive : diversification globale.
  out.push({ icon: Shield, level: "ok", title: "Diversification",
    text: `Patrimoine réparti sur ${new Set(assets.map((a) => a.category)).size} catégorie(s) d'actifs.` });

  return { gross, net, items: out };
}

/* ------------------------------------------------------------------ */
/*  Composants UI                                                      */
/* ------------------------------------------------------------------ */
function Eyebrow({ children }) {
  const C = useTheme();
  return (
    <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: C.brass, fontWeight: 600, marginBottom: 12, display: "flex", alignItems: "center", gap: 7 }}>
      <Hex size={11} color={C.brass} />{children}
    </div>
  );
}
function Card({ children, style }) {
  const C = useTheme();
  const shadow = C.mode === "light" ? "0 1px 3px rgba(27,43,75,.06)" : "none";
  return <div style={{ background: C.inkSoft, border: `1px solid ${C.line}`, borderRadius: 18, padding: 22, boxShadow: shadow, ...style }}>{children}</div>;
}

/* ------------------------------------------------------------------ */
/*  Écran Patrimoine                                                   */
/* ------------------------------------------------------------------ */
function Patrimoine({ assets, wide = false, history = [], onAddSnapshot, onDeleteSnapshot }) {
  const C = useTheme();
  const input = inputStyle(C);
  const { gross, net } = analyse(assets);
  const debt = assets.reduce((s, a) => s + (a.debt || 0), 0);

  // Saisie d'un relevé daté de la valeur nette (suivi dans le temps).
  const today = new Date().toISOString().slice(0, 10);
  const [adding, setAdding] = useState(false);
  const [snapDate, setSnapDate] = useState(today);
  const [snapVal, setSnapVal] = useState("");
  const [snapBusy, setSnapBusy] = useState(false);
  const openAdd = () => { setSnapDate(today); setSnapVal(String(Math.round(net))); setAdding(true); };
  const submitSnap = async () => {
    if (!snapDate || snapVal === "") return;
    setSnapBusy(true);
    await onAddSnapshot?.(snapDate, Number(snapVal));
    setSnapBusy(false); setAdding(false);
  };
  const byCat = useMemo(() => {
    const m = {};
    assets.forEach((a) => { m[a.category] = (m[a.category] || 0) + a.value; });
    return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [assets]);
  const mob = assets.filter((a) => a.type === "mobilier").reduce((s, a) => s + a.value, 0);
  const imm = assets.filter((a) => a.type === "immobilier").reduce((s, a) => s + a.value, 0);

  // Historique réel uniquement, issu des relevés datés saisis par l'utilisateur
  // (net_worth_snapshots). Chaque relevé = un point de la courbe ; le dernier
  // point est le dernier relevé enregistré. Sans relevé encore saisi, un seul
  // point : la valeur nette actuelle — aucune donnée inventée.
  const anneeCourante = new Date().getFullYear().toString();
  const chart = history.length > 0
    ? history.map((h) => ({ m: h.m, v: h.v, date: h.date }))
    : [{ m: anneeCourante, v: net }];

  // Progression depuis le premier relevé (au moins deux points datés requis).
  const perf = history.length > 1 && history[0].v
    ? ((history[history.length - 1].v - history[0].v) / history[0].v) * 100
    : null;

  return (
    <div style={{ display: wide ? "grid" : "flex", gridTemplateColumns: wide ? "1.4fr 1fr" : undefined, flexDirection: wide ? undefined : "column", gap: 18, alignItems: "start" }}>
      <Card style={wide ? { gridColumn: "1 / 2" } : undefined}>
        <Eyebrow>Valeur nette consolidée</Eyebrow>
        <div style={{ fontSize: wide ? 46 : 38, fontFamily: SERIF, fontWeight: 500, color: C.ivory, letterSpacing: "-0.5px", lineHeight: 1 }}>{fmt(net)}</div>
        {perf !== null ? (
          <div style={{ marginTop: 10, color: perf >= 0 ? C.positive : C.alert, fontSize: 14, fontWeight: 500 }}>
            {fmtPct(perf)} <span style={{ color: C.ivorySoft }}>depuis le premier relevé</span>
          </div>
        ) : (
          <div style={{ marginTop: 10, color: C.ivorySoft, fontSize: 13 }}>
            Historique en cours de constitution
          </div>
        )}
        <div style={{ display: "flex", gap: 18, marginTop: 12, fontSize: 12, color: C.ivorySoft }}>
          <span>Brut {fmt(gross)}</span><span>·</span><span>Dette {fmt(debt)}</span>
        </div>
        <div style={{ height: wide ? 220 : 160, marginTop: 14, marginLeft: -10 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chart}>
              <XAxis dataKey="m" tick={{ fill: C.ivorySoft, fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={28} interval="preserveStartEnd" />
              <YAxis hide domain={["dataMin - 50000", "dataMax + 50000"]} />
              <Tooltip contentStyle={{ background: C.ink, border: `1px solid ${C.line}`, borderRadius: 10 }} formatter={(v) => [fmt(v), "Valeur nette"]} labelStyle={{ color: C.brass }} labelFormatter={(label, payload) => { const d = payload && payload[0] && payload[0].payload && payload[0].payload.date; return d ? new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : label; }} />
              <Line type="monotone" dataKey="v" stroke={C.brass} strokeWidth={2.5} dot={{ r: 4, fill: C.brass }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card style={wide ? { gridColumn: "2 / 3" } : undefined}>
        <Eyebrow>Répartition par catégorie</Eyebrow>
        {byCat.length === 0 ? (
          <div style={{ color: C.ivorySoft, fontSize: 13 }}>Aucun actif. Ajoutez-en depuis l'onglet Actifs.</div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div style={{ width: 130, height: 130, flexShrink: 0 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={byCat} dataKey="value" innerRadius={42} outerRadius={62} paddingAngle={2} stroke="none">
                    {byCat.map((_, i) => <Cell key={i} fill={C.pie[i % C.pie.length]} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
              {byCat.map((a, i) => (
                <div key={a.name} style={{ display: "flex", alignItems: "center", fontSize: 13 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: C.pie[i % C.pie.length], marginRight: 9 }} />
                  <span style={{ color: C.ivory, flex: 1 }}>{a.name}</span>
                  <span style={{ color: C.ivorySoft }}>{((a.value / gross) * 100).toFixed(0)} %</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, gridColumn: wide ? "1 / 3" : undefined }}>
        <Card style={{ padding: 18 }}>
          <Briefcase size={20} color={C.brass} />
          <div style={{ fontSize: 12, color: C.ivorySoft, marginTop: 12 }}>Mobilier</div>
          <div style={{ fontSize: 18, color: C.ivory, fontWeight: 600, marginTop: 2 }}>{fmt(mob)}</div>
        </Card>
        <Card style={{ padding: 18 }}>
          <Home size={20} color={C.brass} />
          <div style={{ fontSize: 12, color: C.ivorySoft, marginTop: 12 }}>Immobilier</div>
          <div style={{ fontSize: 18, color: C.ivory, fontWeight: 600, marginTop: 2 }}>{fmt(imm)}</div>
        </Card>
      </div>

      {/* Suivi dans le temps : relevés datés de la valeur nette */}
      <Card style={{ gridColumn: wide ? "1 / 3" : undefined }}>
        <Eyebrow>Suivi dans le temps</Eyebrow>
        <div style={{ fontSize: 12.5, color: C.ivorySoft, lineHeight: 1.55, marginBottom: 14 }}>
          Enregistrez la valeur nette de votre patrimoine à une date donnée pour bâtir la
          courbe — vous pouvez aussi saisir des relevés antérieurs. Aucun relevé n'est enregistré
          automatiquement : seuls les points que vous ajoutez ici apparaissent.
        </div>

        {!adding ? (
          <button onClick={openAdd}
            style={{ width: "100%", background: "transparent", border: `1px dashed ${C.brassSoft}`, borderRadius: 10, padding: "11px", color: C.brass, fontSize: 13, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Plus size={15} /> Ajouter un relevé daté
          </button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, background: C.ink, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 130 }}>
                <label style={{ fontSize: 12, color: C.ivorySoft, display: "block", marginBottom: 6 }}>Date du relevé</label>
                <input type="date" max={today} value={snapDate} onChange={(e) => setSnapDate(e.target.value)} style={{ ...input, colorScheme: "dark" }} />
              </div>
              <div style={{ flex: 1, minWidth: 130 }}>
                <label style={{ fontSize: 12, color: C.ivorySoft, display: "block", marginBottom: 6 }}>Valeur nette (€)</label>
                <input type="number" value={snapVal} onChange={(e) => setSnapVal(e.target.value)} style={input} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setAdding(false)} disabled={snapBusy}
                style={{ flex: 1, background: "transparent", color: C.ivorySoft, border: `1px solid ${C.line}`, borderRadius: 10, padding: "11px", fontSize: 13, cursor: "pointer" }}>Annuler</button>
              <button onClick={submitSnap} disabled={snapBusy || snapVal === ""}
                style={{ flex: 1, background: C.brass, color: C.ink, border: "none", borderRadius: 10, padding: "11px", fontSize: 13, fontWeight: 600, cursor: snapBusy ? "default" : "pointer", opacity: snapBusy || snapVal === "" ? 0.6 : 1 }}>{snapBusy ? "Enregistrement…" : "Enregistrer"}</button>
            </div>
          </div>
        )}

        {history.length > 0 && (
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            {history.slice().reverse().map((h) => (
              <div key={h.date} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, borderBottom: `1px solid ${C.line}`, paddingBottom: 8 }}>
                <span style={{ color: C.ivorySoft, flex: 1 }}>{new Date(h.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })}</span>
                <span style={{ color: C.ivory, fontWeight: 600 }}>{fmt(h.v)}</span>
                <button onClick={() => onDeleteSnapshot?.(h.date)} title="Supprimer ce relevé" style={{ background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex" }}>
                  <Trash2 size={14} color={C.alert} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Écran Actifs                                                       */
/* ------------------------------------------------------------------ */
function Actifs({ assets, onSave, onRemove }) {
  const C = useTheme();
  const input = inputStyle(C);
  const [editing, setEditing] = useState(null);
  const todayISO = new Date().toISOString().slice(0, 10);
  const blank = () => ({ id: null, type: "mobilier", category: "Actions", label: "", value: 0, debt: 0, valuedAt: todayISO });
  const save = async (a) => {
    // Mappe le modèle UI vers les colonnes de la base (kind/value/debt).
    await onSave({
      id: a.id,
      kind: a.type,
      category: a.category,
      label: a.label,
      value: a.value,
      debt: a.debt || 0,
      valuedAt: a.valuedAt || todayISO,
    });
    setEditing(null);
  };
  const remove = (id) => onRemove(id);
  const group = (type) => assets.filter((a) => a.type === type);

  const Section = ({ type, title, Icon }) => {
    const items = group(type);
    const sum = items.reduce((s, a) => s + a.value - (a.debt || 0), 0);
    return (
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <Icon size={18} color={C.brass} />
          <span style={{ color: C.ivory, fontWeight: 600, fontSize: 15, flex: 1 }}>{title}</span>
          <span style={{ color: C.brass, fontSize: 14, fontWeight: 600 }}>{fmt(sum)}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {items.length === 0 && <div style={{ color: C.ivorySoft, fontSize: 13, padding: "4px 0" }}>Aucun actif renseigné.</div>}
          {items.map((a) => (
            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, background: C.ink, borderRadius: 12, padding: "12px 14px", border: `1px solid ${C.line}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: C.ivory, fontSize: 14, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.label || a.category}</div>
                <div style={{ color: C.ivorySoft, fontSize: 12, marginTop: 2 }}>{a.category}{a.valuedAt ? ` · au ${new Date(a.valuedAt).toLocaleDateString("fr-FR")}` : ""}{a.debt > 0 ? ` · dette ${fmt(a.debt)}` : ""}</div>
              </div>
              <div style={{ color: C.ivory, fontSize: 14, fontWeight: 600 }}>{fmt(a.value)}</div>
              <button onClick={() => setEditing(a)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><Pencil size={15} color={C.ivorySoft} /></button>
              <button onClick={() => remove(a.id)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><Trash2 size={15} color={C.alert} /></button>
            </div>
          ))}
        </div>
        <button onClick={() => setEditing({ ...blank(), type, category: CATEGORIES[type][0].key })}
          style={{ marginTop: 12, width: "100%", background: "transparent", border: `1px dashed ${C.brassSoft}`, borderRadius: 10, padding: "11px", color: C.brass, fontSize: 13, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <Plus size={15} /> Ajouter
        </button>
      </Card>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Section type="mobilier" title="Actifs mobiliers" Icon={Wallet} />
      <Section type="immobilier" title="Actifs immobiliers" Icon={Home} />
      {editing && <AssetForm asset={editing} onSave={save} onCancel={() => setEditing(null)} />}
    </div>
  );
}

function AssetForm({ asset, onSave, onCancel }) {
  const C = useTheme();
  const input = inputStyle(C);
  const [a, setA] = useState(asset);
  const isImmo = a.type === "immobilier";
  const today = new Date().toISOString().slice(0, 10);
  const set = (k, v) => setA((p) => ({ ...p, [k]: v }));
  const setType = (t) => setA((p) => ({ ...p, type: t, category: CATEGORIES[t][0].key }));
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(8,12,10,0.7)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50 }} onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 430, background: C.inkSoft, borderRadius: "22px 22px 0 0", borderTop: `1px solid ${C.line}`, padding: 24, animation: "slideUp .25s ease" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
          <span style={{ color: C.ivory, fontSize: 17, fontWeight: 600, flex: 1 }}>{asset.label ? "Modifier l'actif" : "Nouvel actif"}</span>
          <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={20} color={C.ivorySoft} /></button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 8 }}>
            {["mobilier", "immobilier"].map((t) => (
              <button key={t} onClick={() => setType(t)}
                style={{ flex: 1, padding: "10px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 500, textTransform: "capitalize",
                  background: a.type === t ? C.brass : "transparent", color: a.type === t ? C.ink : C.ivorySoft, border: `1px solid ${a.type === t ? C.brass : C.line}` }}>{t}</button>
            ))}
          </div>
          <div>
            <label style={{ fontSize: 12, color: C.ivorySoft, display: "block", marginBottom: 6 }}>Catégorie</label>
            <select value={a.category} onChange={(e) => set("category", e.target.value)} style={{ ...input, colorScheme: "dark", cursor: "pointer" }}>
              {CATEGORIES[a.type].map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: C.ivorySoft, display: "block", marginBottom: 6 }}>Libellé</label>
            <input value={a.label} onChange={(e) => set("label", e.target.value)} placeholder="Ex : PEA Bourse Direct" style={input} />
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 12, color: C.ivorySoft, display: "block", marginBottom: 6 }}>Valeur (€)</label>
              <input type="number" value={a.value || ""} onChange={(e) => set("value", parseFloat(e.target.value) || 0)} style={input} />
            </div>
            {isImmo && (
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: C.ivorySoft, display: "block", marginBottom: 6 }}>Crédit restant (€)</label>
                <input type="number" value={a.debt || ""} onChange={(e) => set("debt", parseFloat(e.target.value) || 0)} style={input} />
              </div>
            )}
          </div>
          <div>
            <label style={{ fontSize: 12, color: C.ivorySoft, display: "block", marginBottom: 6 }}>Date de valorisation</label>
            <input type="date" max={today} value={a.valuedAt || today} onChange={(e) => set("valuedAt", e.target.value)} style={{ ...input, colorScheme: "dark" }} />
          </div>
          <button onClick={() => onSave(a)} disabled={!a.value}
            style={{ marginTop: 4, width: "100%", background: a.value ? C.brass : C.line, color: a.value ? C.ink : C.ivorySoft, border: "none", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 600, cursor: a.value ? "pointer" : "default" }}>Enregistrer</button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Écran TRI — choix simple / SCI à l'IS                              */
/* ------------------------------------------------------------------ */
const SEED_FLOWS = [
  { date: "2021-01-15", amount: -250000 },
  { date: "2022-06-10", amount: -80000 },
  { date: "2023-03-01", amount: 12000 },
  { date: "2024-09-20", amount: 18000 },
  { date: "2026-06-13", amount: 412000 },
];

function TRI() {
  const C = useTheme();
  const [mode, setMode] = useState("simple");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", gap: 8, background: C.inkSoft, padding: 4, borderRadius: 12, border: `1px solid ${C.line}` }}>
        {[["simple", "Flux libres"], ["sci", "Immeuble · SCI à l'IS"]].map(([k, lbl]) => (
          <button key={k} onClick={() => setMode(k)}
            style={{ flex: 1, padding: "10px", borderRadius: 9, cursor: "pointer", fontSize: 13, fontWeight: 600, border: "none",
              background: mode === k ? C.brass : "transparent", color: mode === k ? C.ink : C.ivorySoft }}>{lbl}</button>
        ))}
      </div>
      {mode === "simple" ? <TRISimple /> : <TRISci />}
    </div>
  );
}

function TRISimple() {
  const C = useTheme();
  const input = inputStyle(C);
  const [flows, setFlows] = useState(SEED_FLOWS);
  const rate = useMemo(() => xirr(flows), [flows]);
  const mult = useMemo(() => moic(flows), [flows]);
  const cumul = useMemo(() => cumulative(flows), [flows]);
  const invested = flows.filter((f) => f.amount < 0).reduce((s, f) => s - f.amount, 0);
  const returned = flows.filter((f) => f.amount > 0).reduce((s, f) => s + f.amount, 0);
  const gain = returned - invested;
  const update = (i, k, v) => { const n = [...flows]; n[i] = { ...n[i], [k]: k === "amount" ? (parseFloat(v) || 0) : v }; setFlows(n); };
  const remove = (i) => setFlows(flows.filter((_, j) => j !== i));
  const Metric = ({ label, value, color }) => (
    <div style={{ flex: 1 }}><div style={{ fontSize: 11, color: C.ivorySoft }}>{label}</div><div style={{ color: color || C.ivory, fontWeight: 600, marginTop: 3, fontSize: 15 }}>{value}</div></div>
  );
  return (
    <>
      <Card style={{ textAlign: "center" }}>
        <Eyebrow>Taux de rendement interne</Eyebrow>
        <div style={{ fontSize: 50, fontFamily: SERIF, fontWeight: 500, color: rate === null ? C.ivorySoft : C.brass, letterSpacing: "-0.5px", lineHeight: 1 }}>{rate === null ? "—" : `${(rate * 100).toFixed(1)} %`}</div>
        <div style={{ color: C.ivorySoft, fontSize: 12, marginTop: 8 }}>annualisé · XIRR sur flux datés</div>
        <div style={{ display: "flex", marginTop: 20, paddingTop: 18, borderTop: `1px solid ${C.line}`, gap: 8 }}>
          <Metric label="Investi" value={fmt(invested)} />
          <Metric label="Perçu" value={fmt(returned)} />
          <Metric label="Gain net" value={fmt(gain)} color={gain >= 0 ? C.positive : C.alert} />
          <Metric label="Multiple" value={mult === null ? "—" : `${mult.toFixed(2)}×`} />
        </div>
      </Card>
      {cumul.length >= 2 && (
        <Card>
          <Eyebrow>Position cumulée</Eyebrow>
          <div style={{ height: 150, marginLeft: -10 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={cumul}>
                <defs><linearGradient id="cum" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.brass} stopOpacity={0.3} /><stop offset="100%" stopColor={C.brass} stopOpacity={0} /></linearGradient></defs>
                <XAxis dataKey="date" tick={{ fill: C.ivorySoft, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis hide /><ReferenceLine y={0} stroke={C.line} />
                <Tooltip contentStyle={{ background: C.ink, border: `1px solid ${C.line}`, borderRadius: 10 }} formatter={(v) => [fmt(v), "Cumul"]} labelStyle={{ color: C.brass }} />
                <Area type="monotone" dataKey="cumul" stroke={C.brass} strokeWidth={2} fill="url(#cum)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
      <Card>
        <Eyebrow>Flux de trésorerie</Eyebrow>
        <div style={{ fontSize: 12, color: C.ivorySoft, marginBottom: 14 }}>Négatif = sortie · Positif = entrée.</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {flows.map((f, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="date" value={f.date} onChange={(e) => update(i, "date", e.target.value)} style={{ ...input, flex: 1, fontSize: 13, padding: "10px 12px", colorScheme: "dark" }} />
              <input type="number" value={f.amount} onChange={(e) => update(i, "amount", e.target.value)} style={{ ...input, width: 110, flex: "none", fontSize: 13, fontWeight: 600, textAlign: "right", color: f.amount < 0 ? C.alert : C.positive, padding: "10px 12px" }} />
              <button onClick={() => remove(i)} style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}><Trash2 size={15} color={C.ivorySoft} /></button>
            </div>
          ))}
        </div>
        <button onClick={() => setFlows([...flows, { date: "2026-06-13", amount: 0 }])} style={{ marginTop: 14, width: "100%", background: "transparent", border: `1px dashed ${C.brassSoft}`, borderRadius: 10, padding: "11px", color: C.brass, fontSize: 13, fontWeight: 500, cursor: "pointer" }}>+ Ajouter un flux</button>
      </Card>
    </>
  );
}

/* ----- Module SCI à l'IS ----- */
const SCI_DEFAULTS = {
  prix: 800000, fraisActe: 64000, travaux: 60000, apport: 200000,
  tauxCredit: 3.6, dureeCredit: 20,
  loyerAnnuel: 64000, chargesPct: 22, vacancePct: 5, indexation: 1.5,
  partTerrain: 15, dureeAmortBati: 33,
  appreciation: 1.5, horizon: 15, fraisVente: 7,
};

/* Sous-composants du module SCI, définis au niveau module pour préserver le
   focus des champs (sinon perte de focus à chaque frappe). */
function SciField({ label, value, onChange, suffix }) {
  const C = useTheme();
  const input = inputStyle(C);
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <label style={{ fontSize: 11, color: C.ivorySoft, display: "block", marginBottom: 5 }}>{label}</label>
      <div style={{ position: "relative" }}>
        <input type="number" value={value} onChange={(e) => onChange(e.target.value)} style={{ ...input, fontSize: 13, padding: "9px 10px", paddingRight: suffix ? 30 : 10 }} />
        {suffix && <span style={{ position: "absolute", right: 10, top: 9, color: C.ivorySoft, fontSize: 12 }}>{suffix}</span>}
      </div>
    </div>
  );
}
function SciGroup({ title, children }) {
  const C = useTheme();
  return (
    <Card style={{ padding: 18 }}>
      <div style={{ fontSize: 12, color: C.brass, fontWeight: 600, letterSpacing: "0.05em", marginBottom: 12, textTransform: "uppercase" }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>
    </Card>
  );
}
function SciMetric({ label, value, color }) {
  const C = useTheme();
  return (
    <div style={{ flex: 1 }}><div style={{ fontSize: 11, color: C.ivorySoft }}>{label}</div><div style={{ color: color || C.ivory, fontWeight: 600, marginTop: 3, fontSize: 14 }}>{value}</div></div>
  );
}

function TRISci() {
  const C = useTheme();
  const input = inputStyle(C);
  const [p, setP] = useState(SCI_DEFAULTS);
  const set = (k, v) => setP((s) => ({ ...s, [k]: parseFloat(v) || 0 }));
  const sim = useMemo(() => simulateSCI(p), [p]);

  const chartData = sim.rows.map((r) => ({
    an: `A${r.an}`, cashflow: Math.round(r.cashflow), revente: Math.round(r.revente),
  }));

  return (
    <>
      <Card style={{ textAlign: "center" }}>
        <Eyebrow>TRI net · part de l'associé</Eyebrow>
        <div style={{ fontSize: 50, fontFamily: SERIF, fontWeight: 500, color: sim.tri === null ? C.ivorySoft : C.brass, letterSpacing: "-0.5px", lineHeight: 1 }}>
          {sim.tri === null ? "—" : `${(sim.tri * 100).toFixed(1)} %`}
        </div>
        <div style={{ color: C.ivorySoft, fontSize: 12, marginTop: 8 }}>
          immeuble de rapport · SCI à l'IS · horizon {p.horizon} ans
        </div>
        <div style={{ display: "flex", marginTop: 20, paddingTop: 18, borderTop: `1px solid ${C.line}`, gap: 8 }}>
          <SciMetric label="Apport" value={fmt(sim.apport)} />
          <SciMetric label="Cash-flow cumulé" value={fmt(sim.cumulCash)} color={sim.cumulCash >= 0 ? C.positive : C.alert} />
          <SciMetric label="Produit revente" value={fmt(sim.totalRevente)} />
        </div>
        <div style={{ display: "flex", marginTop: 14, gap: 8 }}>
          <SciMetric label="Emprunt" value={fmt(sim.montantEmprunte)} />
          <SciMetric label="Annuité crédit" value={fmt(sim.annuite)} />
          <SciMetric label="Gain net total" value={fmt(sim.gainTotal)} color={sim.gainTotal >= 0 ? C.positive : C.alert} />
        </div>
      </Card>

      <Card>
        <Eyebrow>Trésorerie annuelle & revente</Eyebrow>
        <div style={{ height: 170, marginLeft: -12 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <XAxis dataKey="an" tick={{ fill: C.ivorySoft, fontSize: 10 }} axisLine={false} tickLine={false} interval={p.horizon > 12 ? 1 : 0} />
              <YAxis hide />
              <ReferenceLine y={0} stroke={C.line} />
              <Tooltip contentStyle={{ background: C.ink, border: `1px solid ${C.line}`, borderRadius: 10 }} formatter={(v, n) => [fmt(v), n === "cashflow" ? "Cash-flow" : "Revente"]} labelStyle={{ color: C.brass }} cursor={{ fill: "rgba(62,140,156,0.08)" }} />
              <Bar dataKey="cashflow" stackId="a" fill={C.positive} radius={[2, 2, 0, 0]} />
              <Bar dataKey="revente" stackId="a" fill={C.brass} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 12, color: C.ivorySoft, justifyContent: "center" }}>
          <span><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: C.positive, marginRight: 6 }} />Cash-flow annuel</span>
          <span><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: C.brass, marginRight: 6 }} />Produit de revente</span>
        </div>
      </Card>

      <SciGroup title="Acquisition">
        <div style={{ display: "flex", gap: 10 }}><SciField label="Prix du bien" value={p.prix} onChange={(v) => set("prix", v)} suffix="€" /><SciField label="Frais d'acte" value={p.fraisActe} onChange={(v) => set("fraisActe", v)} suffix="€" /></div>
        <div style={{ display: "flex", gap: 10 }}><SciField label="Travaux" value={p.travaux} onChange={(v) => set("travaux", v)} suffix="€" /><SciField label="Apport" value={p.apport} onChange={(v) => set("apport", v)} suffix="€" /></div>
      </SciGroup>
      <SciGroup title="Financement">
        <div style={{ display: "flex", gap: 10 }}><SciField label="Taux du crédit" value={p.tauxCredit} onChange={(v) => set("tauxCredit", v)} suffix="%" /><SciField label="Durée" value={p.dureeCredit} onChange={(v) => set("dureeCredit", v)} suffix="ans" /></div>
      </SciGroup>
      <SciGroup title="Exploitation">
        <div style={{ display: "flex", gap: 10 }}><SciField label="Loyers / an" value={p.loyerAnnuel} onChange={(v) => set("loyerAnnuel", v)} suffix="€" /><SciField label="Charges" value={p.chargesPct} onChange={(v) => set("chargesPct", v)} suffix="%" /></div>
        <div style={{ display: "flex", gap: 10 }}><SciField label="Vacance" value={p.vacancePct} onChange={(v) => set("vacancePct", v)} suffix="%" /><SciField label="Indexation loyers" value={p.indexation} onChange={(v) => set("indexation", v)} suffix="%" /></div>
      </SciGroup>
      <SciGroup title="Amortissement (IS)">
        <div style={{ display: "flex", gap: 10 }}><SciField label="Part terrain" value={p.partTerrain} onChange={(v) => set("partTerrain", v)} suffix="%" /><SciField label="Durée amort. bâti" value={p.dureeAmortBati} onChange={(v) => set("dureeAmortBati", v)} suffix="ans" /></div>
      </SciGroup>
      <SciGroup title="Revente">
        <div style={{ display: "flex", gap: 10 }}><SciField label="Appréciation / an" value={p.appreciation} onChange={(v) => set("appreciation", v)} suffix="%" /><SciField label="Horizon" value={p.horizon} onChange={(v) => set("horizon", v)} suffix="ans" /></div>
        <div style={{ display: "flex", gap: 10 }}><SciField label="Frais de vente" value={p.fraisVente} onChange={(v) => set("fraisVente", v)} suffix="%" /><div style={{ flex: 1 }} /></div>
      </SciGroup>

      <Card style={{ padding: 16 }}>
        <div style={{ fontSize: 11.5, color: C.ivorySoft, lineHeight: 1.6 }}>
          IS au barème 2026 (15 % jusqu'à 42 500 € de résultat, 25 % au-delà). À la revente, la plus-value imposable réintègre les amortissements pratiqués (prix net − valeur nette comptable), sans abattement pour durée de détention. Simulation informative à hypothèses constantes ; elle ne constitue pas un conseil en investissement ni une projection garantie. Pour une étude personnalisée, contactez {CABINET.name}.
        </div>
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Écran Analyse                                                      */
/* ------------------------------------------------------------------ */
function Analyse({ assets }) {
  const C = useTheme();
  const input = inputStyle(C);
  const { gross, net, items } = useMemo(() => analyse(assets), [assets]);
  const col = (l) => (l === "alert" ? C.alert : l === "warn" ? C.warn : C.positive);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Card>
        <Eyebrow>Lecture du patrimoine</Eyebrow>
        <div style={{ fontSize: 13, color: C.ivorySoft, lineHeight: 1.6 }}>
          Analyse informative fondée sur vos actifs (net {fmt(net)} · brut {fmt(gross)}). Elle ne constitue pas une recommandation personnalisée d'investissement.
        </div>
      </Card>
      {items.length === 0 && <Card><div style={{ color: C.ivorySoft, fontSize: 13 }}>Renseignez vos actifs pour générer l'analyse.</div></Card>}
      {items.map((it, i) => {
        const Icon = it.icon, c = col(it.level);
        return (
          <Card key={i} style={{ borderLeft: `3px solid ${c}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <Icon size={18} color={c} />
              <span style={{ color: C.ivory, fontWeight: 600, fontSize: 15 }}>{it.title}</span>
              {it.level === "alert" && <AlertTriangle size={15} color={C.alert} style={{ marginLeft: "auto" }} />}
            </div>
            <div style={{ fontSize: 13, color: C.ivorySoft, lineHeight: 1.6 }}>{it.text}</div>
          </Card>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Écran Conseiller                                                   */
/* ------------------------------------------------------------------ */
// Agenda des conférences. Seul le prochain événement à venir est affiché ; le
// lendemain d'un événement, le suivant prend automatiquement sa place. Si tous
// sont passés dans l'année en cours, on repart sur le premier de l'année suivante.
const EVENEMENTS = [
  { d: 3, m: 9, label: "Cession d'entreprises" },
  { d: 1, m: 10, label: "Placements financiers" },
  { d: 5, m: 11, label: "Protection et transmission" },
  { d: 3, m: 12, label: "Assurance Vie Luxembourgeoise" },
];

function prochainEvenement() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const y = now.getFullYear();
  const dansLAnnee = EVENEMENTS.map((e) => ({ ...e, date: new Date(y, e.m - 1, e.d) }));
  return (
    dansLAnnee.find((e) => e.date >= today) ||
    { ...EVENEMENTS[0], date: new Date(y + 1, EVENEMENTS[0].m - 1, EVENEMENTS[0].d) }
  );
}

function Conseiller() {
  const C = useTheme();
  const ev = prochainEvenement();
  const evJour = ev.date.getDate();
  const evMois = ev.date.toLocaleDateString("fr-FR", { month: "short" }).replace(".", "").toUpperCase();
  const evDate = ev.date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Card style={{ textAlign: "center", padding: 28 }}>
        <div style={{ margin: "0 auto 16px", display: "inline-flex", background: "#fff", borderRadius: 14, padding: "14px 18px" }}>
          <img src="/logo-hexa.jpeg" alt="Hexa Patrimoine" style={{ height: 54, width: "auto", display: "block" }} />
        </div>
        <div style={{ color: C.ivory, fontSize: 19, fontWeight: 600 }}>Hexa Patrimoine — Julien DANIEL</div>
        <div style={{ color: C.brass, fontSize: 13, marginTop: 3 }}>Conseil en gestion de patrimoine</div>
        <div style={{ color: C.ivorySoft, fontSize: 12, marginTop: 6 }}>CIF · membre ANACOFI · ORIAS n° 26004342</div>
        <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
          <a href={`tel:${CABINET.tel}`} style={{ flex: 1, textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: C.brass, borderRadius: 12, padding: "14px", color: C.ink, fontWeight: 600, fontSize: 14 }}><Phone size={17} /> Appeler</a>
          <a href={`mailto:${CABINET.email}`} style={{ flex: 1, textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "transparent", border: `1px solid ${C.brass}`, borderRadius: 12, padding: "14px", color: C.brass, fontWeight: 600, fontSize: 14 }}><Mail size={17} /> Écrire</a>
        </div>
        <div style={{ color: C.ivorySoft, fontSize: 13, marginTop: 16 }}>{CABINET.telDisplay}</div>
      </Card>
      <Card>
        <Eyebrow>Prochain événement</Eyebrow>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ textAlign: "center", background: C.ink, borderRadius: 12, padding: "10px 14px", border: `1px solid ${C.line}`, minWidth: 56 }}>
            <div style={{ color: C.brass, fontSize: 22, fontWeight: 600, lineHeight: 1 }}>{evJour}</div>
            <div style={{ color: C.ivorySoft, fontSize: 11, marginTop: 2 }}>{evMois}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ color: C.ivory, fontSize: 14, fontWeight: 500 }}>{ev.label}</div>
            <div style={{ color: C.ivorySoft, fontSize: 12, marginTop: 2 }}>{evDate} · conférence</div>
          </div>
          <ChevronRight size={18} color={C.ivorySoft} />
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Module Budget — capacité d'épargne                                 */
/*  Champ défini au niveau module pour préserver le focus à la frappe. */
/* ------------------------------------------------------------------ */
function BudgetRow({ label, value, onChange, color }) {
  const C = useTheme();
  const input = inputStyle(C);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ flex: 1, fontSize: 13, color: C.ivory }}>{label}</span>
      <div style={{ position: "relative", width: 130 }}>
        <input type="number" value={value || ""} onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          style={{ ...input, fontSize: 13, padding: "9px 26px 9px 10px", textAlign: "right", color: color || C.ivory, fontWeight: 600 }} />
        <span style={{ position: "absolute", right: 10, top: 9, color: C.ivorySoft, fontSize: 12 }}>€</span>
      </div>
    </div>
  );
}

function Budget() {
  const C = useTheme();
  const input = inputStyle(C);
  const [revenus, setRevenus] = useState({ salaires: 4200, foncier: 0, autres: 0 });
  const [depenses, setDepenses] = useState({ logement: 1200, credits: 650, vie: 1100, loisirs: 400, autres: 300 });

  const totalRev = Object.values(revenus).reduce((s, v) => s + v, 0);
  const totalDep = Object.values(depenses).reduce((s, v) => s + v, 0);
  const epargne = totalRev - totalDep;
  const taux = totalRev > 0 ? (epargne / totalRev) * 100 : 0;

  const setR = (k, v) => setRevenus((s) => ({ ...s, [k]: v }));
  const setD = (k, v) => setDepenses((s) => ({ ...s, [k]: v }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Card style={{ textAlign: "center" }}>
        <Eyebrow>Capacité d'épargne mensuelle</Eyebrow>
        <div style={{ fontSize: 46, fontFamily: SERIF, fontWeight: 500, color: epargne >= 0 ? C.positive : C.alert, letterSpacing: "-0.5px", lineHeight: 1 }}>
          {fmt(epargne)}
        </div>
        <div style={{ color: C.ivorySoft, fontSize: 13, marginTop: 8 }}>
          {epargne >= 0 ? `soit ${taux.toFixed(0)} % des revenus · ${fmt(epargne * 12)} par an` : "budget déséquilibré"}
        </div>
        <div style={{ display: "flex", marginTop: 20, paddingTop: 18, borderTop: `1px solid ${C.line}`, gap: 8 }}>
          <div style={{ flex: 1 }}><div style={{ fontSize: 11, color: C.ivorySoft }}>Revenus</div><div style={{ color: C.ivory, fontWeight: 600, marginTop: 3 }}>{fmt(totalRev)}</div></div>
          <div style={{ flex: 1 }}><div style={{ fontSize: 11, color: C.ivorySoft }}>Dépenses</div><div style={{ color: C.ivory, fontWeight: 600, marginTop: 3 }}>{fmt(totalDep)}</div></div>
          <div style={{ flex: 1 }}><div style={{ fontSize: 11, color: C.ivorySoft }}>Taux d'épargne</div><div style={{ color: epargne >= 0 ? C.positive : C.alert, fontWeight: 600, marginTop: 3 }}>{taux.toFixed(0)} %</div></div>
        </div>
      </Card>

      <Card>
        <Eyebrow>Revenus mensuels</Eyebrow>
        <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
          <BudgetRow label="Salaires / pensions" value={revenus.salaires} onChange={(v) => setR("salaires", v)} color={C.positive} />
          <BudgetRow label="Revenus fonciers" value={revenus.foncier} onChange={(v) => setR("foncier", v)} color={C.positive} />
          <BudgetRow label="Autres revenus" value={revenus.autres} onChange={(v) => setR("autres", v)} color={C.positive} />
        </div>
      </Card>

      <Card>
        <Eyebrow>Dépenses mensuelles</Eyebrow>
        <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
          <BudgetRow label="Logement (loyer, charges)" value={depenses.logement} onChange={(v) => setD("logement", v)} color={C.alert} />
          <BudgetRow label="Crédits & emprunts" value={depenses.credits} onChange={(v) => setD("credits", v)} color={C.alert} />
          <BudgetRow label="Vie courante (alimentation…)" value={depenses.vie} onChange={(v) => setD("vie", v)} color={C.alert} />
          <BudgetRow label="Loisirs & sorties" value={depenses.loisirs} onChange={(v) => setD("loisirs", v)} color={C.alert} />
          <BudgetRow label="Autres dépenses" value={depenses.autres} onChange={(v) => setD("autres", v)} color={C.alert} />
        </div>
      </Card>

      {epargne > 0 && (
        <Card style={{ borderLeft: `3px solid ${C.positive}` }}>
          <div style={{ fontSize: 13, color: C.ivorySoft, lineHeight: 1.6 }}>
            Avec {fmt(epargne)} d'épargne mensuelle, vous pouvez vous constituer {fmt(epargne * 12)} par an. Cette capacité peut servir de base à un effort d'investissement régulier, à arbitrer avec votre conseiller selon vos objectifs.
          </div>
        </Card>
      )}

      <div style={{ fontSize: 11, color: C.ivorySoft, lineHeight: 1.6, padding: "0 4px" }}>
        Estimation indicative à partir des montants que vous saisissez. Elle ne constitue pas un conseil budgétaire ou en investissement personnalisé.
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Wrapper client : charge les actifs depuis Supabase et orchestre    */
/*  les onglets. Remplace l'état en mémoire du prototype.              */
/* ------------------------------------------------------------------ */
export const CLIENT_TABS = [
  { id: "patrimoine", label: "Patrimoine", icon: TrendingUp },
  { id: "actifs", label: "Actifs", icon: Wallet },
  { id: "budget", label: "Budget", icon: PiggyBank },
  { id: "tri", label: "TRI", icon: Calculator },
  { id: "analyse", label: "Analyse", icon: Shield },
  { id: "conseiller", label: "Expert", icon: Phone },
  { id: "donnees", label: "Données", icon: Lock },
];

// La base renvoie {kind, value, debt...}. Les écrans attendent {type,...}.
const fromDb = (row) => ({
  id: row.id, type: row.kind, category: row.category,
  label: row.label, value: Number(row.value), debt: Number(row.debt),
  valuedAt: row.valued_at || null,
});

// `tab` et `setTab` sont fournis par App (navigation partagée avec le menu
// latéral sur ordinateur). `isDesktop` masque la barre d'onglets du bas.
export default function ClientApp({ tab = "patrimoine", setTab = () => {}, isDesktop = false }) {
  const [assets, setAssets] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  // Recharge l'historique des relevés datés (net_worth_snapshots) → courbe.
  const reloadHistory = async () => {
    const { data } = await listNetWorthHistory();
    setHistory(
      data && data.length
        ? data.map((r) => ({
            m: new Date(r.captured_at).getFullYear().toString(),
            v: Number(r.net_worth),
            date: r.captured_at,
          }))
        : []
    );
  };

  const refresh = async () => {
    const { data, error } = await listAssets();
    if (!error && data) {
      setAssets(data.map(fromDb));
      // Aucun enregistrement automatique : la courbe ne reflète que les relevés
      // datés saisis par l'utilisateur. On se contente de (re)charger l'historique.
      // Best-effort : si la table d'historique n'existe pas encore, on ignore l'erreur.
      try { await reloadHistory(); } catch (_) { /* historique indisponible */ }
    }
    setLoading(false);
  };
  useEffect(() => { refresh(); }, []);

  const handleSave = async (assetDb) => {
    await upsertAsset(assetDb);
    await refresh();
  };
  const handleRemove = async (id) => {
    await deleteAsset(id);
    await refresh();
  };

  // Relevés datés : ajout / suppression manuelle d'un point de la courbe, pour
  // construire un suivi dans le temps (y compris des valeurs antérieures).
  const addSnapshot = async (capturedAt, net) => {
    try { await recordNetWorthSnapshot({ net, gross: net, debt: 0, capturedAt }); await reloadHistory(); }
    catch (_) { /* table d'historique indisponible côté Supabase */ }
  };
  const removeSnapshot = async (capturedAt) => {
    try { await deleteNetWorthSnapshot(capturedAt); await reloadHistory(); }
    catch (_) { /* ignore */ }
  };

  // Sur ordinateur : contenu large, centré, sans barre d'onglets en bas.
  const contentPad = isDesktop ? "32px 40px 40px" : "20px 18px 96px";
  const contentMax = isDesktop ? 1100 : "none";

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ flex: 1, padding: contentPad, overflowY: "auto" }}>
        <div style={{ maxWidth: contentMax, margin: "0 auto" }}>
          {loading && tab !== "tri" && tab !== "conseiller"
            ? <div style={{ color: "#9AA6BE", fontSize: 13, padding: 8 }}>Chargement de votre patrimoine…</div>
            : <>
                {tab === "patrimoine" && <Patrimoine assets={assets} wide={isDesktop} history={history} onAddSnapshot={addSnapshot} onDeleteSnapshot={removeSnapshot} />}
                {tab === "actifs" && <Actifs assets={assets} onSave={handleSave} onRemove={handleRemove} />}
                {tab === "budget" && <Budget />}
                {tab === "tri" && <TRI />}
                {tab === "analyse" && <Analyse assets={assets} />}
                {tab === "conseiller" && <Conseiller />}
                {tab === "donnees" && <MesDonnees />}
              </>}
        </div>
      </div>
      {!isDesktop && (
        <div style={{ position: "sticky", bottom: 0, display: "flex", background: "#1B2B4B", borderTop: "1px solid #2A3A5C", paddingBottom: "env(safe-area-inset-bottom)" }}>
          {CLIENT_TABS.map((t) => {
            const Icon = t.icon, on = t.id === tab;
            return (
              <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, minWidth: 0, background: "none", border: "none", cursor: "pointer", padding: "11px 0 13px", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <Icon size={18} color={on ? "#3E8C9C" : "#9AA6BE"} strokeWidth={on ? 2.4 : 1.8} />
                <span style={{ fontSize: 9, color: on ? "#3E8C9C" : "#9AA6BE", fontWeight: on ? 600 : 400, whiteSpace: "nowrap" }}>{t.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
