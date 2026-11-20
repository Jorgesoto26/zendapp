// src/components/CamouflageCalculator.js
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Vibration,
  Platform,
} from 'react-native';

export default function CamouflageCalculator({ onExit }) {
  const [displayValue, setDisplayValue] = useState('0');
  const [prevValue, setPrevValue] = useState(null);
  const [operation, setOperation] = useState(null);
  const [clearOnNextDigit, setClearOnNextDigit] = useState(false);
  const [expression, setExpression] = useState('');

  const handleDigit = useCallback((digit) => {
    setDisplayValue((prev) => {
      if (clearOnNextDigit || prev === '0') {
        setClearOnNextDigit(false);
        return String(digit);
      }
      if (prev.length >= 12) return prev;
      return prev + digit;
    });
  }, [clearOnNextDigit]);

  const handleDecimal = useCallback(() => {
    setDisplayValue((prev) => {
      if (clearOnNextDigit) {
        setClearOnNextDigit(false);
        return '0.';
      }
      if (prev.includes('.')) return prev;
      return prev + '.';
    });
  }, [clearOnNextDigit]);

  const handleClear = useCallback(() => {
    setDisplayValue('0');
    setPrevValue(null);
    setOperation(null);
    setClearOnNextDigit(false);
    setExpression('');
  }, []);

  const handleBackspace = useCallback(() => {
    setDisplayValue((prev) => {
      if (prev.length <= 1 || prev === '0') return '0';
      return prev.slice(0, -1);
    });
  }, []);

  const handleToggleSign = useCallback(() => {
    setDisplayValue((prev) => {
      if (prev === '0') return '0';
      return prev.startsWith('-') ? prev.slice(1) : '-' + prev;
    });
  }, []);

  const handlePercentage = useCallback(() => {
    setDisplayValue((prev) => {
      const num = parseFloat(prev);
      if (isNaN(num)) return '0';
      return String(num / 100);
    });
  }, []);

  const compute = (a, b, op) => {
    const numA = parseFloat(a);
    const numB = parseFloat(b);
    if (isNaN(numA) || isNaN(numB)) return '0';
    let res = 0;
    switch (op) {
      case '+': res = numA + numB; break;
      case '−': res = numA - numB; break;
      case '×': res = numA * numB; break;
      case '÷': res = numB === 0 ? 'Error' : numA / numB; break;
      default: return b;
    }
    if (res === 'Error') return 'Error';
    // Redondear a máximo 8 decimales si es necesario
    const rounded = Math.round(res * 100000000) / 100000000;
    return String(rounded);
  };

  const handleOperation = useCallback((op) => {
    if (prevValue !== null && operation && !clearOnNextDigit) {
      const res = compute(prevValue, displayValue, operation);
      setDisplayValue(res);
      setPrevValue(res);
      setExpression(`${res} ${op}`);
    } else {
      setPrevValue(displayValue);
      setExpression(`${displayValue} ${op}`);
    }
    setOperation(op);
    setClearOnNextDigit(true);
  }, [displayValue, prevValue, operation, clearOnNextDigit]);

  const handleEquals = useCallback(() => {
    if (prevValue === null || !operation) return;
    const res = compute(prevValue, displayValue, operation);
    setExpression(`${prevValue} ${operation} ${displayValue} =`);
    setDisplayValue(res);
    setPrevValue(null);
    setOperation(null);
    setClearOnNextDigit(true);
  }, [prevValue, displayValue, operation]);

  // Salida secreta: toques sostenidos de 2 segundos en el botón "=" o en el visor
  const handleSecretExit = () => {
    if (onExit) onExit();
  };

  const renderButton = (label, type, onPress, onLongPress = null) => {
    const isOp = type === 'operator';
    const isSpecial = type === 'special';
    const isZero = type === 'zero';

    return (
      <TouchableOpacity
        key={label}
        style={[
          styles.btn,
          isZero && styles.btnZero,
          isOp && styles.btnOperator,
          isSpecial && styles.btnSpecial,
          operation === label && styles.btnOperatorActive,
        ]}
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={800}
        activeOpacity={0.7}
      >
        <Text
          style={[
            styles.btnText,
            isOp && styles.btnOperatorText,
            isSpecial && styles.btnSpecialText,
          ]}
        >
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#17171C" />

      {/* Visor con área secreta en long-press */}
      <TouchableOpacity
        style={styles.displayContainer}
        activeOpacity={1}
        onLongPress={handleSecretExit}
        delayLongPress={800}
      >
        <Text style={styles.expressionText} numberOfLines={1}>
          {expression}
        </Text>
        <Text
          style={[
            styles.displayText,
            displayValue.length > 8 && styles.displayTextSmall,
          ]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {displayValue}
        </Text>
      </TouchableOpacity>

      {/* Teclado de Calculadora */}
      <View style={styles.keypad}>
        <View style={styles.row}>
          {renderButton('C', 'special', handleClear)}
          {renderButton('+/-', 'special', handleToggleSign)}
          {renderButton('%', 'special', handlePercentage)}
          {renderButton('÷', 'operator', () => handleOperation('÷'))}
        </View>

        <View style={styles.row}>
          {renderButton('7', 'num', () => handleDigit(7))}
          {renderButton('8', 'num', () => handleDigit(8))}
          {renderButton('9', 'num', () => handleDigit(9))}
          {renderButton('×', 'operator', () => handleOperation('×'))}
        </View>

        <View style={styles.row}>
          {renderButton('4', 'num', () => handleDigit(4))}
          {renderButton('5', 'num', () => handleDigit(5))}
          {renderButton('6', 'num', () => handleDigit(6))}
          {renderButton('−', 'operator', () => handleOperation('−'))}
        </View>

        <View style={styles.row}>
          {renderButton('1', 'num', () => handleDigit(1))}
          {renderButton('2', 'num', () => handleDigit(2))}
          {renderButton('3', 'num', () => handleDigit(3))}
          {renderButton('+', 'operator', () => handleOperation('+'))}
        </View>

        <View style={styles.row}>
          {renderButton('0', 'zero', () => handleDigit(0))}
          {renderButton('.', 'num', handleDecimal)}
          {renderButton('⌫', 'num', handleBackspace)}
          {/* El botón "=" tiene el gatillo secreto sostenido por 2 segundos */}
          {renderButton('=', 'operator', handleEquals, handleSecretExit)}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#17171C',
    justifyContent: 'flex-end',
  },
  displayContainer: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    paddingHorizontal: 24,
    paddingBottom: 20,
  },
  expressionText: {
    fontSize: 22,
    color: '#8E8E93',
    marginBottom: 8,
    fontWeight: '400',
  },
  displayText: {
    fontSize: 64,
    color: '#FFFFFF',
    fontWeight: '300',
    letterSpacing: -1,
  },
  displayTextSmall: {
    fontSize: 44,
  },
  keypad: {
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === 'ios' ? 24 : 16,
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  btn: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 999,
    backgroundColor: '#2E2F38',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnZero: {
    flex: 1,
  },
  btnOperator: {
    backgroundColor: '#EE272D',
  },
  btnOperatorActive: {
    backgroundColor: '#FFFFFF',
  },
  btnSpecial: {
    backgroundColor: '#4E505F',
  },
  btnText: {
    fontSize: 28,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  btnOperatorText: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '600',
  },
  btnSpecialText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '600',
  },
});
