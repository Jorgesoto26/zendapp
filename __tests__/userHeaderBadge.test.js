// __tests__/userHeaderBadge.test.js
jest.mock('react-native-vector-icons/FontAwesome', () => 'Icon');
jest.mock('react-native-modal', () => 'Modal');
jest.mock('../src/components/AppAlert', () => ({
  appAlert: jest.fn(),
}));
jest.mock('../src/context/AuthContext', () => ({
  useAuth: jest.fn(),
}));

import { getUserDisplayName, getUserRoleLabel } from '../src/components/UserHeaderBadge';

describe('UserHeaderBadge - Visualización del usuario autenticado en toda la app', () => {
  describe('getUserDisplayName', () => {
    test('Retorna nombre y apellido completos si ambos están presentes', () => {
      expect(getUserDisplayName({ nombre: 'Jorge', apellidos: 'Soto' })).toBe('Jorge Soto');
      expect(getUserDisplayName({ nombre: 'Ana', apellido: 'Gómez' })).toBe('Ana Gómez');
    });

    test('Retorna solo nombre si no hay apellidos', () => {
      expect(getUserDisplayName({ nombre: 'Carlos' })).toBe('Carlos');
      expect(getUserDisplayName({ nombre: '  María  ', apellidos: '' })).toBe('María');
    });

    test('Retorna fallback Usuario si profile es null, undefined o vacío', () => {
      expect(getUserDisplayName(null)).toBe('Usuario');
      expect(getUserDisplayName(undefined)).toBe('Usuario');
      expect(getUserDisplayName({})).toBe('Usuario');
      expect(getUserDisplayName({ nombre: '', apellidos: '' })).toBe('Usuario');
    });
  });

  describe('getUserRoleLabel', () => {
    test('Mapea correctamente el rol a etiqueta amigable', () => {
      expect(getUserRoleLabel('vendedor')).toBe('Vendedor');
      expect(getUserRoleLabel('VENDEDOR')).toBe('Vendedor');
      expect(getUserRoleLabel('admin')).toBe('Administrador');
      expect(getUserRoleLabel('superadmin')).toBe('Superadmin');
      expect(getUserRoleLabel('cliente')).toBe('Cliente');
      expect(getUserRoleLabel(null)).toBe('Vendedor');
      expect(getUserRoleLabel(undefined)).toBe('Vendedor');
    });
  });
});
