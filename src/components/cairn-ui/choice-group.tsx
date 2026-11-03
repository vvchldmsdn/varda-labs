import type { ComponentProps } from 'react';
import styles from './choice-group.module.css';

/** Presents existing pressed buttons; callers keep selection state and behavior. */
export function ChoiceGroup({label,appearance='underline',className,...props}:ComponentProps<'div'>&{label:string;appearance?:'underline'|'segmented'}){
  return <div {...props} role="group" aria-label={label} data-cairn-choice data-appearance={appearance} className={[styles.group,className].filter(Boolean).join(' ')}/>;
}
