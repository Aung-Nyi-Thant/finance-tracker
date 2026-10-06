import { categoryStyle } from '../theme/categories';
import { NeuBadge } from './fx/NeuBadge';

/** Floating neumorphic badge for a category (fork/knife for Food, controller for Games, ...). */
export function CategoryIcon({ category, size = 44, float, phase }: { category: string; size?: number; float?: boolean; phase?: number }) {
  const { icon, color } = categoryStyle(category);
  return <NeuBadge icon={icon} color={color} size={size} float={float} phase={phase} />;
}
