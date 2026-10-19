import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { native } from '../data/api';
import { Card, Field, Toggle } from './UI';
export function AppearanceSettings() {
  const [motion, setMotion] = useState(localStorage.getItem('greenbiz-motion') || 'system'),
    [haptics, setHaptics] = useState(localStorage.getItem('greenbiz-haptics') !== 'off');
  return (
    <Card>
      <div className="row">
        <Sparkles size={20} />
        <h2>A little more feel</h2>
      </div>
      <Field label="Animations">
        <select
          value={motion}
          onChange={(e) => {
            setMotion(e.target.value);
            localStorage.setItem('greenbiz-motion', e.target.value);
            window.dispatchEvent(new Event('greenbizExperience'));
          }}
        >
          <option value="system">Smooth · respect system preference</option>
          <option value="reduced">Reduced motion</option>
        </select>
      </Field>
      <p className="small muted">
        Soft transitions, responsive buttons and animated reports. Your phone’s reduced-motion
        preference always takes priority.
      </p>
      {native && (
        <div className="row between">
          <span>Gentle touch feedback</span>
          <Toggle
            label="Gentle touch feedback"
            value={haptics}
            onChange={(value) => {
              setHaptics(value);
              localStorage.setItem('greenbiz-haptics', value ? 'on' : 'off');
            }}
          />
        </div>
      )}
    </Card>
  );
}
