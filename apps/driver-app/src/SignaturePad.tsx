import { useRef, useState } from 'react';
import { PanResponder, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Button, colors, s } from './ui';

export type Strokes = [number, number][][];

const clamp = (v: number) => Math.min(1, Math.max(0, Math.round(v * 1000) / 1000));
const toPath = (st: [number, number][], w: number, h: number) =>
  st.map(([x, y], i) => `${i ? 'L' : 'M'}${(x * w).toFixed(1)},${(y * h).toFixed(1)}`).join(' ');

/** Finger signature; strokes are stored normalised to 0–1 of the pad. */
export function SignaturePad({
  value,
  onChange,
}: {
  value: Strokes;
  onChange: (v: Strokes) => void;
}) {
  const [size, setSize] = useState({ w: 1, h: 1 });
  const strokes = useRef<Strokes>(value);
  strokes.current = value;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const pt = (x: number, y: number): [number, number] => [
    clamp(x / sizeRef.current.w),
    clamp(y / sizeRef.current.h),
  ];
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const { locationX, locationY } = e.nativeEvent;
        onChange([...strokes.current, [pt(locationX, locationY)]].slice(-100));
      },
      onPanResponderMove: (e) => {
        const { locationX, locationY } = e.nativeEvent;
        const all = strokes.current.slice();
        const last = all[all.length - 1];
        if (!last || last.length >= 2000) return;
        all[all.length - 1] = [...last, pt(locationX, locationY)];
        onChange(all);
      },
    }),
  ).current;

  return (
    <View style={{ gap: 6 }}>
      <View
        {...pan.panHandlers}
        onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        style={{
          height: 160,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 8,
          backgroundColor: '#fff',
        }}
        accessibilityLabel="Signature pad"
      >
        <Svg width="100%" height="100%">
          {value.map((st, i) => (
            <Path
              key={i}
              d={toPath(st, size.w, size.h)}
              stroke={colors.text}
              strokeWidth={2.5}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </Svg>
        {value.length === 0 && (
          <View pointerEvents="none" style={{ position: 'absolute', top: 68, alignSelf: 'center' }}>
            <Text style={s.muted}>Customer signs here</Text>
          </View>
        )}
      </View>
      {value.length > 0 && (
        <Button title="Clear signature" kind="secondary" onPress={() => onChange([])} />
      )}
    </View>
  );
}
