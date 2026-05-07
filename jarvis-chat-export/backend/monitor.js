const { getLastEventForAutomation } = require("./log-ingest-store");

// Brazil: UTC-3, sem horario de verao desde 2019
const TZ_OFFSET_MS = -3 * 60 * 60 * 1000;
const OVERDUE_HOURS = 5;

const AUTOMATIONS = [
  { name: "Programacao_de_Pedidos",  displayName: "Programação de Pedidos",  connected: true,  schedule: { type: "weekdays", times: ["05:40"] } },
  { name: "Pedidos_em_Carga",        displayName: "Pedidos em Carga",        connected: true,  schedule: { type: "weekdays", times: ["05:50"] } },
  { name: "Saldo_Cotia",             displayName: "Saldo Cotia",             connected: true,  schedule: { type: "daily",    times: ["07:00", "14:00"] } },
  { name: "Acompanhamento_e_Meta",   displayName: "Acompanhamento e Meta",   connected: true,  schedule: { type: "daily",    times: ["07:30", "12:00", "15:30", "19:00"] } },
  { name: "Curva_A",                 displayName: "Curva A",                 connected: false, schedule: { type: "monthly",  days: [1, 10, 20], times: ["00:00"] } },
  { name: "Curva_A_30_Dias",         displayName: "Curva A 30 Dias",         connected: false, schedule: { type: "daily",    times: ["01:00"] } },
  { name: "Matriz_Afiliados",        displayName: "Matriz Afiliados",        connected: false, schedule: { type: "weekdays", times: ["02:00"] } },
  { name: "Orcamento_Acompanhamento",displayName: "Orçamento Acompanhamento",connected: false, schedule: { type: "weekdays", times: ["06:10", "10:00", "13:00", "16:00"] } },
  { name: "Estoque_Analitico",       displayName: "Estoque Analítico",       connected: false, schedule: { type: "weekdays", times: ["06:20"] } },
  { name: "Orcamento_Produto",       displayName: "Orçamento + Produto",     connected: false, schedule: { type: "weekdays", times: ["06:10", "10:00", "13:00", "16:00"] } },
  { name: "Reposicao_Estoque",       displayName: "Reposição de Estoque",    connected: false, schedule: { type: "daily",    times: ["07:00", "14:00"] } },
];

function toLocal(utcDate) {
  return new Date(utcDate.getTime() + TZ_OFFSET_MS);
}

function getLastExpectedRun(schedule, nowUtc) {
  const nowLocal = toLocal(nowUtc);
  const candidates = [];

  for (let offset = 0; offset <= 1; offset++) {
    const day = new Date(nowLocal);
    day.setDate(day.getDate() - offset);

    const dow = day.getDay();
    const dom = day.getDate();

    let runs = false;
    if (schedule.type === "daily")    runs = true;
    if (schedule.type === "weekdays") runs = dow >= 1 && dow <= 5;
    if (schedule.type === "monthly")  runs = (schedule.days || []).includes(dom);
    if (!runs) continue;

    for (const timeStr of schedule.times) {
      const [h, m] = timeStr.split(":").map(Number);
      const scheduledLocal = new Date(day);
      scheduledLocal.setHours(h, m, 0, 0);
      const scheduledUtc = new Date(scheduledLocal.getTime() - TZ_OFFSET_MS);
      if (scheduledUtc <= nowUtc) candidates.push(scheduledUtc);
    }
  }

  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => b - a)[0];
}

async function getMonitorStatus() {
  const nowUtc = new Date();

  const results = await Promise.all(
    AUTOMATIONS.map(async (auto) => {
      if (!auto.connected) {
        return { name: auto.name, displayName: auto.displayName, connected: false, status: "not_connected", lastExpectedRun: null, lastEventAt: null, hoursElapsed: null };
      }

      const lastExpectedUtc = getLastExpectedRun(auto.schedule, nowUtc);
      if (!lastExpectedUtc) {
        return { name: auto.name, displayName: auto.displayName, connected: true, status: "not_scheduled", lastExpectedRun: null, lastEventAt: null, hoursElapsed: null };
      }

      const hoursElapsed = (nowUtc - lastExpectedUtc) / (1000 * 60 * 60);
      const lastEvent = await getLastEventForAutomation(auto.name, lastExpectedUtc);

      let status;
      if (lastEvent)                     status = "ok";
      else if (hoursElapsed >= OVERDUE_HOURS) status = "overdue";
      else                               status = "pending";

      return {
        name: auto.name,
        displayName: auto.displayName,
        connected: true,
        status,
        lastExpectedRun: lastExpectedUtc.toISOString(),
        lastEventAt: lastEvent?.timestamp || null,
        hoursElapsed: Number(hoursElapsed.toFixed(1)),
      };
    })
  );

  return {
    timestamp: nowUtc.toISOString(),
    overdueCount: results.filter((r) => r.status === "overdue").length,
    automations: results,
  };
}

module.exports = { getMonitorStatus };
