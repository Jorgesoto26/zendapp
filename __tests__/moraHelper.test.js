// __tests__/moraHelper.test.js
import {
  calculateCuotasAtrasadas,
  calculateSaldoVencido,
  getMoraStatus,
  MORA_STATUS,
  MORA_COLORS,
} from '../src/utils/moraHelper';
import { zendapp } from '../src/theme/zendappTheme';

describe('moraHelper - Señales visuales de morosidad en Card de Pagos', () => {
  describe('getMoraStatus', () => {
    test('Saldo 0 retorna estado Al Día con borde verde', () => {
      const res = getMoraStatus(0, 0);
      expect(res.status).toBe(MORA_STATUS.AL_DIA);
      expect(res.borderColor).toBe(zendapp.colors.success);
      expect(res.borderWidth).toBe(2);
      expect(res.badgeText).toBe('Al día');
    });

    test('0 cuotas vencidas con saldo positivo retorna Al Día con borde verde', () => {
      const res = getMoraStatus(0, 1000);
      expect(res.status).toBe(MORA_STATUS.AL_DIA);
      expect(res.borderColor).toBe(zendapp.colors.success);
      expect(res.borderWidth).toBe(2);
      expect(res.badgeText).toBe('Al día');
    });

    test('1 cuota vencida retorna Alerta con borde amarillo y texto singular', () => {
      const res = getMoraStatus(1, 2000);
      expect(res.status).toBe(MORA_STATUS.ALERTA);
      expect(res.borderColor).toBe(zendapp.colors.warning);
      expect(res.borderWidth).toBe(2);
      expect(res.badgeText).toBe('1 cuota vencida');
    });

    test('De 2 a 5 cuotas vencidas retorna Alerta con borde amarillo', () => {
      [2, 3, 4, 5].forEach((n) => {
        const res = getMoraStatus(n, 3000);
        expect(res.status).toBe(MORA_STATUS.ALERTA);
        expect(res.borderColor).toBe(zendapp.colors.warning);
        expect(res.borderWidth).toBe(2);
        expect(res.badgeText).toBe(`${n} cuotas vencidas`);
      });
    });

    test('Más de 5 cuotas vencidas (6 en adelante) retorna Moroso con borde rojo', () => {
      [6, 7, 10, 20].forEach((n) => {
        const res = getMoraStatus(n, 4000);
        expect(res.status).toBe(MORA_STATUS.MOROSO);
        expect(res.borderColor).toBe(zendapp.colors.danger);
        expect(res.borderWidth).toBe(2);
        expect(res.badgeText).toBe(`${n} cuotas vencidas`);
      });
    });
  });

  describe('calculateCuotasAtrasadas - Cuotas vencidas antes de hoy (excluyendo la de hoy)', () => {
    test('Cliente creado el 11/11/2026 con 1 cuota pagada al día 18/11/2026: cuotas vencidas van del 12 al 17 inclusive = 6 cuotas -> ROJO', () => {
      const factura = {
        id: 'fac-1',
        fecha: '2026-11-11',
        periodicidad: 'diario',
        num_cuotas: 30,
        cuotasPagas: 1,
        saldo: 80000,
        valorCuota: 8000,
        pago_adelantado: true,
      };

      const refDate = new Date(2026, 10, 18); // 18 de Noviembre de 2026
      const vencidas = calculateCuotasAtrasadas(factura, null, refDate);

      // Entre 11/11 y 18/11 han transcurrido 7 días.
      // Cuotas esperadas antes de hoy: 7 (del 11 al 17). Pagada: 1 (la del 11).
      // Vencidas estrictamente antes de hoy (12 al 17 inclusive): 6 cuotas.
      expect(vencidas).toBe(6);

      const status = getMoraStatus(vencidas, factura.saldo);
      expect(status.status).toBe(MORA_STATUS.MOROSO);
      expect(status.borderColor).toBe(zendapp.colors.danger);
      expect(status.borderWidth).toBe(2);
      expect(status.badgeText).toBe('6 cuotas vencidas');

      const saldoVencido = calculateSaldoVencido(factura, vencidas);
      expect(saldoVencido).toBe(48000); // 6 * 8000 = 48000
    });

    test('Mismo cliente al día siguiente de crearse (12/11/2026): 0 cuotas vencidas antes de hoy -> VERDE (Al día)', () => {
      const factura = {
        id: 'fac-1',
        fecha: '2026-11-11',
        periodicidad: 'diario',
        num_cuotas: 30,
        cuotasPagas: 1,
        saldo: 80000,
        valorCuota: 8000,
        pago_adelantado: true,
      };

      const refDate = new Date(2026, 10, 12); // 12 de Noviembre de 2026
      const vencidas = calculateCuotasAtrasadas(factura, null, refDate);
      expect(vencidas).toBe(0);

      const status = getMoraStatus(vencidas, factura.saldo);
      expect(status.status).toBe(MORA_STATUS.AL_DIA);
      expect(status.borderColor).toBe(zendapp.colors.success);
      expect(status.badgeText).toBe('Al día');

      const saldoVencido = calculateSaldoVencido(factura, vencidas);
      expect(saldoVencido).toBe(0);
    });

    test('Mismo cliente al día 13/11/2026: 1 cuota vencida (la del 12) -> AMARILLO', () => {
      const factura = {
        id: 'fac-1',
        fecha: '2026-11-11',
        periodicidad: 'diario',
        num_cuotas: 30,
        cuotasPagas: 1,
        saldo: 80000,
        valorCuota: 8000,
        pago_adelantado: true,
      };

      const refDate = new Date(2026, 10, 13);
      const vencidas = calculateCuotasAtrasadas(factura, null, refDate);
      expect(vencidas).toBe(1);

      const status = getMoraStatus(vencidas, factura.saldo);
      expect(status.status).toBe(MORA_STATUS.ALERTA);
      expect(status.borderColor).toBe(zendapp.colors.warning);
      expect(status.badgeText).toBe('1 cuota vencida');

      const saldoVencido = calculateSaldoVencido(factura, vencidas);
      expect(saldoVencido).toBe(8000); // 1 * 8000 = 8000
    });

    test('Mismo cliente al día 17/11/2026: 5 cuotas vencidas (12 al 16) -> AMARILLO', () => {
      const factura = {
        id: 'fac-1',
        fecha: '2026-11-11',
        periodicidad: 'diario',
        num_cuotas: 30,
        cuotasPagas: 1,
        saldo: 80000,
        valorCuota: 8000,
        pago_adelantado: true,
      };

      const refDate = new Date(2026, 10, 17);
      const vencidas = calculateCuotasAtrasadas(factura, null, refDate);
      expect(vencidas).toBe(5);

      const status = getMoraStatus(vencidas, factura.saldo);
      expect(status.status).toBe(MORA_STATUS.ALERTA);
      expect(status.borderColor).toBe(zendapp.colors.warning);
      expect(status.badgeText).toBe('5 cuotas vencidas');

      const saldoVencido = calculateSaldoVencido(factura, vencidas);
      expect(saldoVencido).toBe(40000); // 5 * 8000 = 40000
    });

    test('Prioriza el conteo exacto de la tabla cuotas en SQLite si está disponible', () => {
      const factura = {
        id: 'fac-1',
        fecha: '2026-11-11',
        saldo: 80000,
        valorCuota: 8000,
        cuotasPagas: 1,
      };

      // Si SQLite reporta exactamente 6 cuotas pendientes con vencimiento < hoy
      const vencidas = calculateCuotasAtrasadas(factura, 6);
      expect(vencidas).toBe(6);

      const status = getMoraStatus(vencidas, factura.saldo);
      expect(status.status).toBe(MORA_STATUS.MOROSO);
      expect(status.borderColor).toBe(zendapp.colors.danger);
    });

    test('Protege contra desfase en SQLite si la BD reporta 5 pero por calendario corresponden 6 cuotas vencidas', () => {
      const factura = {
        id: 'fac-1',
        fecha: '2026-11-11',
        periodicidad: 'diario',
        num_cuotas: 30,
        cuotasPagas: 1,
        saldo: 80000,
        valorCuota: 8000,
        pago_adelantado: true,
      };

      const refDate = new Date(2026, 10, 18);
      // Supongamos que SQLite reporta 5 por haber guardado cuota 1 con fecha 12/11
      const vencidas = calculateCuotasAtrasadas(factura, 5, refDate);
      expect(vencidas).toBe(6); // El cálculo matemático protege y asegura 6

      const saldoVencido = calculateSaldoVencido(factura, vencidas, 40000);
      expect(saldoVencido).toBe(48000); // Asegura 48000 (6 * 8000)
    });

    test('Crédito sin pago adelantado (pago_adelantado = false): al día 1 está al día y al día 7 tiene 6 vencidas', () => {
      const factura = {
        id: 'fac-sin-adelanto',
        fecha: '2026-11-11',
        periodicidad: 'diario',
        num_cuotas: 30,
        cuotasPagas: 0,
        saldo: 80000,
        valorCuota: 8000,
        pago_adelantado: false,
      };

      // Al día siguiente (12/11): la cuota 1 vence hoy, antes de hoy van 0 vencidas
      const refDia1 = new Date(2026, 10, 12);
      const vencidasDia1 = calculateCuotasAtrasadas(factura, null, refDia1);
      expect(vencidasDia1).toBe(0);
      expect(getMoraStatus(vencidasDia1, factura.saldo).status).toBe(MORA_STATUS.AL_DIA);

      // Al día 7 (18/11): vencidas del 12 al 17 inclusive = 6 cuotas
      const refDia7 = new Date(2026, 10, 18);
      const vencidasDia7 = calculateCuotasAtrasadas(factura, null, refDia7);
      expect(vencidasDia7).toBe(6);
      expect(getMoraStatus(vencidasDia7, factura.saldo).status).toBe(MORA_STATUS.MOROSO);
      expect(calculateSaldoVencido(factura, vencidasDia7)).toBe(48000);
    });

    test('Si el crédito está pagado en su totalidad, retorna 0 cuotas y borde verde', () => {
      const factura = {
        id: 'fac-pagado',
        fecha: '2026-10-01',
        saldo: 0,
        estado: 'pagada',
        cuotasPagas: 30,
      };

      const vencidas = calculateCuotasAtrasadas(factura, 0);
      expect(vencidas).toBe(0);

      const status = getMoraStatus(vencidas, 0);
      expect(status.status).toBe(MORA_STATUS.AL_DIA);
      expect(status.borderColor).toBe(zendapp.colors.success);
      expect(status.badgeText).toBe('Al día');
    });
  });

  describe('calculateSaldoVencido - Saldo vencido entre Cuota y Saldo Pendiente', () => {
    test('Si saldo es 0, saldo vencido es 0', () => {
      const res = calculateSaldoVencido({ saldo: 0, valorCuota: 8000 }, 5);
      expect(res).toBe(0);
    });

    test('Si cliente está al día (0 cuotas vencidas), saldo vencido es 0', () => {
      const res = calculateSaldoVencido({ saldo: 80000, valorCuota: 8000 }, 0);
      expect(res).toBe(0);
    });

    test('Cliente del caso de uso (6 cuotas vencidas con cuota de 8000): saldo vencido es 48000 (6 * 8000)', () => {
      const res = calculateSaldoVencido({ saldo: 80000, valorCuota: 8000 }, 6);
      expect(res).toBe(48000);
    });

    test('Cliente con 2 cuotas vencidas con cuota de 8000: saldo vencido es 16000 (2 * 8000)', () => {
      const res = calculateSaldoVencido({ saldo: 80000, valorCuota: 8000 }, 2);
      expect(res).toBe(16000);
    });

    test('Prioriza saldoVencidoDirect si viene de la base de datos', () => {
      const res = calculateSaldoVencido({ saldo: 80000, valorCuota: 8000 }, 6, 48000);
      expect(res).toBe(48000);
    });

    test('No excede el saldo pendiente total', () => {
      const res = calculateSaldoVencido({ saldo: 30000, valorCuota: 8000 }, 6);
      expect(res).toBe(30000);
    });
  });
});
