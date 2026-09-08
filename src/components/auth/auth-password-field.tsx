"use client";

import { AuthText, AuthElement } from "./auth-localized";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import {
  AUTH_MAX_PASSWORD_LENGTH,
  AUTH_MIN_NEW_PASSWORD_LENGTH,
} from "@/lib/auth/auth-methods";
import styles from "./auth-experience.module.css";

export function AuthPasswordField({
  id,
  label = "비밀번호",
  newPassword = false,
}: {
  id: string;
  label?: string;
  newPassword?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className={styles.field}>
      <label htmlFor={id}><AuthText>{label}</AuthText></label>
      <div className={styles.passwordField}>
        <AuthElement as="input"
          id={id}
          name={id}
          type={visible ? "text" : "password"}
          autoComplete={newPassword ? "new-password" : "current-password"}
          minLength={newPassword ? AUTH_MIN_NEW_PASSWORD_LENGTH : 1}
          maxLength={AUTH_MAX_PASSWORD_LENGTH}
          placeholder={newPassword ? "12자 이상" : "비밀번호 입력"}
          required
          className={styles.input}
        />
        <AuthElement as="button"
          type="button"
          className={styles.passwordToggle}
          onClick={() => setVisible(!visible)}
          aria-label={`${label} ${visible ? "숨기기" : "표시"}`}
          aria-pressed={visible}
          title={visible ? "비밀번호 숨기기" : "비밀번호 표시"}
        >
          {visible ? (
            <EyeOff size={18} aria-hidden="true" />
          ) : (
            <Eye size={18} aria-hidden="true" />
          )}
        </AuthElement>
      </div>
    </div>
  );
}
