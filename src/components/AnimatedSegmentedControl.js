// src/components/AnimatedSegmentedControl.js
import React, { useRef, useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Dimensions,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { zendapp } from '../theme/zendappTheme';

/**
 * AnimatedSegmentedControl
 * Control segmentado estándar con indicador deslizante en GPU a 60 FPS (idéntico a Payments.js).
 * Soporta cualquier cantidad de opciones (strings o { key, label, icon, badge }).
 * Elevation: 0 estricto en Android para evitar artefactos en esquinas redondeadas.
 */
export default function AnimatedSegmentedControl({
  options = [],
  selectedKey,
  onChange,
  style,
  tabStyle,
  activeTabStyle,
  textStyle,
  activeTextStyle,
  padding = 3,
}) {
  // Normalizar opciones a formato unificado { key, label, icon, badge }
  const normalizedOptions = useMemo(() => {
    return options.map((opt) => {
      if (typeof opt === 'string') {
        return {
          key: opt,
          label: opt.charAt(0).toUpperCase() + opt.slice(1),
          icon: null,
          badge: null,
        };
      }
      return {
        key: opt.key,
        label: opt.label || opt.key,
        icon: opt.icon || null,
        badge: opt.badge !== undefined && opt.badge !== null ? opt.badge : null,
      };
    });
  }, [options]);

  const count = normalizedOptions.length;
  const selectedIndex = useMemo(() => {
    const idx = normalizedOptions.findIndex((o) => o.key === selectedKey);
    return idx >= 0 ? idx : 0;
  }, [normalizedOptions, selectedKey]);

  const [trackWidth, setTrackWidth] = useState(0);
  const slideAnim = useRef(new Animated.Value(selectedIndex)).current;

  // Animación física de resorte (100% nativa en GPU)
  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: selectedIndex,
      useNativeDriver: true,
      friction: 9,
      tension: 65,
    }).start();
  }, [selectedIndex, slideAnim]);

  const tabWidth = useMemo(() => {
    if (trackWidth <= 0 || count === 0) return 0;
    return (trackWidth - padding * 2) / count;
  }, [trackWidth, count, padding]);

  const translateX = useMemo(() => {
    if (count <= 1 || tabWidth <= 0) return 0;
    return slideAnim.interpolate({
      inputRange: normalizedOptions.map((_, i) => i),
      outputRange: normalizedOptions.map((_, i) => i * tabWidth),
    });
  }, [slideAnim, normalizedOptions, count, tabWidth]);

  const handleSelect = (key) => {
    if (key === selectedKey) return;
    if (onChange) onChange(key);
  };

  return (
    <View
      style={[styles.track, { padding }, style]}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        if (w > 0 && Math.abs(w - trackWidth) > 1) {
          setTrackWidth(w);
        }
      }}
    >
      {/* Fondo blanco animado deslizante con borde sutil */}
      {tabWidth > 0 && (
        <Animated.View
          style={[
            styles.activeBg,
            {
              top: padding,
              left: padding,
              bottom: padding,
              width: tabWidth,
              transform: [{ translateX }],
            },
            activeTabStyle,
          ]}
        />
      )}

      {/* Botones de las opciones */}
      {normalizedOptions.map((opt, idx) => {
        const isActive = opt.key === selectedKey || (selectedKey === undefined && idx === 0);
        return (
          <TouchableOpacity
            key={opt.key}
            activeOpacity={0.7}
            onPress={() => handleSelect(opt.key)}
            style={[styles.tab, tabStyle]}
          >
            {opt.icon ? (
              <Icon
                name={opt.icon}
                size={12}
                color={isActive ? zendapp.colors.carbon : zendapp.colors.textSecondary}
                style={styles.tabIcon}
              />
            ) : null}

            <Text
              style={[
                styles.tabText,
                textStyle,
                isActive && styles.tabTextActive,
                isActive && activeTextStyle,
              ]}
              numberOfLines={1}
            >
              {opt.label}
            </Text>

            {opt.badge !== null ? (
              <View style={[styles.badge, isActive && styles.badgeActive]}>
                <Text style={[styles.badgeText, isActive && styles.badgeTextActive]}>
                  {opt.badge}
                </Text>
              </View>
            ) : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: '#F2F4F7',
    borderRadius: 12,
    position: 'relative',
    borderWidth: 1,
    borderColor: '#EAECF0',
    alignItems: 'center',
  },
  activeBg: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#EAECF0',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 2,
      },
      android: { elevation: 0 },
      default: { elevation: 0 },
    }),
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 8,
    zIndex: 1,
    gap: 6,
  },
  tabIcon: {
    marginRight: 2,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
    color: zendapp.colors.textSecondary,
    textAlign: 'center',
  },
  tabTextActive: {
    color: zendapp.colors.carbon,
    fontWeight: '700',
  },
  badge: {
    backgroundColor: '#E4E7EC',
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 999,
    minWidth: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeActive: {
    backgroundColor: zendapp.colors.carbon,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: zendapp.colors.textSecondary,
  },
  badgeTextActive: {
    color: '#FFFFFF',
  },
});

