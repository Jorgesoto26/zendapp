// src/screens/admin/components/HierarchyBreadcrumb.js
import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { apple } from '../../../theme/appleTheme';
import { zendapp } from '../../../theme/zendappTheme';

/**
 * Componente de barra de navegación jerárquica (Breadcrumbs + Botón Atrás)
 * @param {Array<{ id: string, name: string }>} stack - Pila de niveles navegados
 * @param {Function} onPop - Función para retroceder (recibe opcionalmente el índice destino)
 * @param {string} rootTitle - Título del nivel raíz (por defecto 'Mi Equipo')
 */
export const HierarchyBreadcrumb = ({
  stack = [],
  onPop,
  rootTitle = 'Mi Equipo',
}) => {
  if (!stack || stack.length <= 1) {
    return null;
  }

  const currentLevel = stack[stack.length - 1];
  const previousLevel = stack[stack.length - 2];

  return (
    <View style={styles.container}>
      {/* Botón Volver Rápido */}
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => onPop && onPop(stack.length - 2)}
        activeOpacity={0.7}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Icon name="chevron-left" size={13} color={zendapp.colors.primary} />
        <Text style={styles.backButtonText} numberOfLines={1}>
          {previousLevel?.name || 'Atrás'}
        </Text>
      </TouchableOpacity>

      {/* Rastro de Migas de Pan (Breadcrumb trail) */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.trailScroll}
        style={styles.scrollView}
      >
        {stack.map((item, index) => {
          const isLast = index === stack.length - 1;
          const displayName = index === 0 ? (item.name || rootTitle) : item.name;

          return (
            <View key={`${item.id}-${index}`} style={styles.trailItemWrapper}>
              {index > 0 && (
                <Icon
                  name="angle-right"
                  size={12}
                  color={apple.colors.tertiaryLabel}
                  style={styles.separatorIcon}
                />
              )}
              {isLast ? (
                <View style={[styles.pill, styles.pillActive]}>
                  <Icon
                    name="sitemap"
                    size={11}
                    color="#FFFFFF"
                    style={{ marginRight: 5 }}
                  />
                  <Text style={styles.pillTextActive} numberOfLines={1}>
                    {displayName}
                  </Text>
                </View>
              ) : (
                <TouchableOpacity
                  onPress={() => onPop && onPop(index)}
                  activeOpacity={0.7}
                  style={[styles.pill, styles.pillInactive]}
                >
                  <Text style={styles.pillTextInactive} numberOfLines={1}>
                    {displayName}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: apple.colors.separator,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: zendapp.colors.primaryLight,
    borderWidth: 1,
    borderColor: zendapp.colors.primaryBorder,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginRight: 8,
    maxWidth: 130,
  },
  backButtonText: {
    ...apple.typography.footnote,
    color: zendapp.colors.primary,
    fontWeight: '700',
    marginLeft: 5,
  },
  scrollView: {
    flex: 1,
  },
  trailScroll: {
    alignItems: 'center',
    paddingRight: 10,
  },
  trailItemWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  separatorIcon: {
    marginHorizontal: 4,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 6,
  },
  pillActive: {
    backgroundColor: zendapp.colors.carbon,
  },
  pillInactive: {
    backgroundColor: '#F1F3F7',
  },
  pillTextActive: {
    ...apple.typography.caption1,
    color: '#FFFFFF',
    fontWeight: '700',
    maxWidth: 120,
  },
  pillTextInactive: {
    ...apple.typography.caption1,
    color: zendapp.colors.textSecondary,
    fontWeight: '600',
    maxWidth: 100,
  },
});

