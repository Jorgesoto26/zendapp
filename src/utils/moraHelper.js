// src/utils/moraHelper.js
import { zendapp } from '../theme/zendappTheme';

/**
 * Estados semánticos de mora para la vista de pagos de vendedores:
 * - al_dia: Cuotas al día (<= 1 cuota debida: solo debe la cuota del día actual, o saldo en 0)
 * - alerta: Alerta de atraso (debe de 2 a 5 cuotas)
 * - moroso: Morosidad crítica (más de 5 cuotas)
 */
export const MORA_STATUS = {
  AL_DIA: 'al_dia',
  ALERTA: 'alerta',
  MOROSO: 'moroso',
};

export const MORA_COLORS = {
  [MORA_STATUS.AL_DIA]: {
    color: zendapp?.colors?.success || '#10B981',
    bg: '#ECFDF5',
    borderColor: zendapp?.colors?.success || '#10B981',
    borderWidth: 2,
    badgeText: 'Al día',
    icon: 'check-circle',
  },
  [MORA_STATUS.ALERTA]: {
    color: '#D97706', // Ámbar oscuro para texto legible
    bg: '#FFFBEB',
    borderColor: zendapp?.colors?.warning || '#F59E0B',
    borderWidth: 2,
    badgeText: 'cuotas',
    icon: 'exclamation-circle',
  },
  [MORA_STATUS.MOROSO]: {
    color: zendapp?.colors?.danger || '#EE272D',
    bg: '#FEF2F2',
    borderColor: zendapp?.colors?.danger || '#EE272D',
    borderWidth: 2,
    badgeText: 'cuotas en mora',
    icon: 'exclamation-triangle',
  },
};

/**
 * Calcula el número de cuotas debidas/atrasadas hasta la fecha actual (o de referencia).
 * 
 * Reglas de negocio:
 * 1. Si el saldo es <= 0 o la factura está pagada -> 0 cuotas debidas.
 * 2. Si se proporciona cuotasFromDbCount (conteo directo de tabla cuotas con vencimiento <= hoy no pagadas) -> se usa ese valor.
 * 3. Fallback: Cálculo matemático según fecha de creación, periodicidad, pago adelantado y cuotas pagadas.
 * 
 * @param {Object} factura - Registro de la factura (saldo, fecha, periodicidad, cuotasPagas, num_cuotas, pago_adelantado, cuotasVencidas)
 * @param {number|null} [cuotasFromDbCount] - Conteo directo desde SQLite
 * @param {Date|string} [referenceDate] - Fecha de referencia para pruebas y cálculo
 * @returns {number} Número de cuotas debidas hasta la fecha
 */
export const calculateCuotasAtrasadas = (factura = {}, cuotasFromDbCount = null, referenceDate = new Date()) => {
  const saldo = Number(factura.saldo || 0);
  const estadoFactura = String(factura.estado || factura.estadoPago || '').toLowerCase().trim();
  if (saldo <= 0 || estadoFactura === 'pagada' || estadoFactura === 'pagado') {
    return 0;
  }

  const cuotasVencidasRemotas = Number(factura.cuotasVencidas || 0);

  let mathVencidas = 0;
  let hasMathCalculation = false;

  if (factura.fecha) {
    try {
      const fechaClean = String(factura.fecha).split('T')[0].split(' ')[0];
      const parts = fechaClean.split('-').map(Number);
      if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
        const startDate = new Date(parts[0], parts[1] - 1, parts[2]);
        const refDate = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
        const today = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate());

        if (startDate <= today) {
          const diffMs = today.getTime() - startDate.getTime();
          const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

          const periodicidad = String(factura.periodicidad || 'diario').toLowerCase().trim();
          const pagoAdelantado = factura.pago_adelantado === 1 || factura.pago_adelantado === true || factura.pagoAdelantado === 1 || factura.pagoAdelantado === true;
          const cuotasPagas = Number(factura.cuotasPagas || 0);
          const numCuotas = Number(factura.num_cuotas || factura.numCuotas || 0) || 30;

          let periodosTranscurridos = 0;
          if (periodicidad === 'semanal') {
            periodosTranscurridos = Math.floor(diffDays / 7);
          } else if (periodicidad === 'quincenal') {
            periodosTranscurridos = Math.floor(diffDays / 15);
          } else if (periodicidad === 'mensual') {
            periodosTranscurridos = (today.getFullYear() - startDate.getFullYear()) * 12 + (today.getMonth() - startDate.getMonth());
            if (today.getDate() < startDate.getDate() && periodosTranscurridos > 0) {
              periodosTranscurridos -= 1;
            }
          } else {
            // diario
            periodosTranscurridos = diffDays;
          }

          // Cuotas esperadas que han vencido estrictamente antes de hoy (excluyendo la cuota de hoy que se cobra en el campo CUOTA)
          // Si hubo pago adelantado (cuota 1 en día 0), las cuotas esperadas antes de hoy = periodosTranscurridos.
          // Si no hubo pago adelantado (cuota 1 en día 1), las cuotas esperadas antes de hoy = periodosTranscurridos - 1.
          const cuotasEsperadasAntesDeHoy = Math.min(
            numCuotas,
            pagoAdelantado ? periodosTranscurridos : Math.max(0, periodosTranscurridos - 1)
          );

          mathVencidas = Math.max(0, cuotasEsperadasAntesDeHoy - cuotasPagas);
          hasMathCalculation = true;
        }
      }
    } catch (err) {
      // fallback
    }
  }

  // Si tenemos el conteo de la tabla cuotas en SQLite, tomamos el mayor para proteger contra desfases en BD
  if (typeof cuotasFromDbCount === 'number' && cuotasFromDbCount >= 0) {
    if (hasMathCalculation) {
      return Math.max(cuotasFromDbCount, mathVencidas);
    }
    return cuotasFromDbCount;
  }

  if (hasMathCalculation) {
    return mathVencidas;
  }

  return cuotasVencidasRemotas > 0 ? cuotasVencidasRemotas : 0;
};

/**
 * Obtiene el estado visual, color de borde y texto para el card de cliente según las reglas:
 * - Verde: Al día (0 cuotas vencidas antes de hoy: solo debe la cuota del día actual, o saldo en 0)
 * - Amarillo: De 1 a 5 cuotas vencidas
 * - Rojo: Más de 5 cuotas vencidas
 * 
 * @param {number} cuotasVencidas - Conteo de cuotas vencidas estrictamente antes de hoy
 * @param {number} [saldo=1] - Saldo restante de la factura
 * @returns {Object} Configuración visual para el card
 */
export const getMoraStatus = (cuotasVencidas = 0, saldo = 1) => {
  const numSaldo = Number(saldo || 0);
  if (numSaldo <= 0) {
    return {
      status: MORA_STATUS.AL_DIA,
      ...MORA_COLORS[MORA_STATUS.AL_DIA],
      badgeText: 'Al día',
      cuotasVencidas: 0,
    };
  }

  const vencidas = Math.max(0, Number(cuotasVencidas) || 0);

  // Al día: 0 cuotas vencidas antes de hoy (solo debe la cuota del día actual)
  if (vencidas === 0) {
    return {
      status: MORA_STATUS.AL_DIA,
      ...MORA_COLORS[MORA_STATUS.AL_DIA],
      badgeText: 'Al día',
      cuotasVencidas: 0,
    };
  }

  // De 1 a 5 cuotas vencidas antes de hoy -> Alerta (Amarillo)
  if (vencidas >= 1 && vencidas <= 5) {
    return {
      status: MORA_STATUS.ALERTA,
      ...MORA_COLORS[MORA_STATUS.ALERTA],
      badgeText: `${vencidas} cuota${vencidas > 1 ? 's' : ''} vencida${vencidas > 1 ? 's' : ''}`,
      cuotasVencidas: vencidas,
    };
  }

  // Más de 5 cuotas vencidas -> Moroso (Rojo)
  return {
    status: MORA_STATUS.MOROSO,
    ...MORA_COLORS[MORA_STATUS.MOROSO],
    badgeText: `${vencidas} cuotas vencidas`,
    cuotasVencidas: vencidas,
  };
};

/**
 * Calcula el saldo vencido del cliente correspondiente a las cuotas vencidas antes de hoy.
 * La cuota del día actual se excluye porque ya aparece en el campo CUOTA.
 * Si el cliente está al día (0 cuotas vencidas), su saldo vencido es 0.
 * Si tiene cuotas vencidas (ej. 6 cuotas de 8000 del 12 al 17 inclusive), el saldo vencido es 48000 (6 * 8000).
 * 
 * @param {Object} factura - Registro de la factura (saldo, valorCuota, amount, saldoVencido)
 * @param {number} [cuotasVencidas=0] - Total de cuotas vencidas antes de hoy
 * @param {number|null} [saldoVencidoDirect=null] - Saldo vencido directo si proviene de SQLite/Supabase
 * @returns {number} Monto vencido en dinero
 */
export const calculateSaldoVencido = (factura = {}, cuotasVencidas = 0, saldoVencidoDirect = null) => {
  const saldo = Number(factura.saldo || 0);
  if (saldo <= 0) return 0;

  const numVencidas = Math.max(0, Number(cuotasVencidas || 0));

  // Si está al día (0 cuotas vencidas antes de hoy), el saldo vencido es 0
  if (numVencidas === 0) {
    return 0;
  }

  // Multiplicación directa de las cuotas vencidas por el valor de la cuota (ej. 6 * 8000 = 48000)
  const valorCuota = Number(factura.valorCuota || factura.amount || 0);
  const mathSaldoVencido = valorCuota > 0 ? numVencidas * valorCuota : 0;

  // Si viene el monto de SQLite, tomamos el mayor para proteger contra desfases
  if (typeof saldoVencidoDirect === 'number' && saldoVencidoDirect > 0) {
    return Math.min(saldo, Math.max(saldoVencidoDirect, mathSaldoVencido));
  }

  if (mathSaldoVencido > 0) {
    return Math.min(saldo, mathSaldoVencido);
  }

  const directProp = Number(factura.saldoVencido || 0);
  if (directProp > 0) {
    return Math.min(saldo, directProp);
  }

  return 0;
};
