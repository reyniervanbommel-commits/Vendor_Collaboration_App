import React, { useState, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { getLoginReasonMessage } from '../../utils/sessionExpiry';
import {
  Button,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Spinner,
  Text,
  makeStyles,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import { Eye20Regular, EyeOff20Regular } from '@fluentui/react-icons';
import { APP_DISPLAY_NAME } from '../../config/app';

const LAST_LOGIN_EMAIL_KEY = 'auth:last-login-email';

function getStoredLoginEmail() {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(LAST_LOGIN_EMAIL_KEY) || '';
  } catch (_) {
    return '';
  }
}

function storeLoginEmail(email) {
  if (typeof window === 'undefined') return;
  try {
    if (email) {
      window.localStorage.setItem(LAST_LOGIN_EMAIL_KEY, email);
      return;
    }
    window.localStorage.removeItem(LAST_LOGIN_EMAIL_KEY);
  } catch (_) {
    // Ignore storage errors (private mode/quota) and keep login flow working.
  }
}

const NARROW = '@media (max-width: 760px)';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    background: 'linear-gradient(150deg, #F5F3F0 0%, #E8E4DF 40%, #D0D8E8 100%)',
    ...shorthands.padding('24px'),
    [NARROW]: { ...shorthands.padding('16px') },
  },
  loginCard: {
    width: '100%',
    maxWidth: '1100px',
    minHeight: '560px',
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    position: 'relative',
    backgroundColor: '#FBFAF7',
    ...shorthands.borderRadius('12px'),
    ...shorthands.overflow('hidden'),
    boxShadow: '0 12px 48px rgba(22, 38, 61, 0.12), 0 2px 8px rgba(22, 38, 61, 0.06)',
    [NARROW]: { gridTemplateColumns: '1fr', minHeight: 'auto' },
  },
  visual: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    ...shorthands.padding('48px', '40px'),
    [NARROW]: { ...shorthands.padding('32px', '24px', '0') },
  },
  // Transparent-background cut of logo-circle.png, so it sits directly on the card.
  illustration: {
    display: 'block',
    width: 'min(420px, 100%)',
    height: 'auto',
    [NARROW]: { width: 'min(240px, 75%)' },
  },
  // Soft blue cloud in the top-right corner, echoing the one behind the figures.
  blob: {
    position: 'absolute',
    top: '-70px',
    right: '-60px',
    width: '300px',
    height: 'auto',
    pointerEvents: 'none',
    [NARROW]: { display: 'none' },
  },
  formPanel: {
    position: 'relative',
    zIndex: 1,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    ...shorthands.gap('24px'),
    ...shorthands.padding('48px', '48px', '48px', '16px'),
    maxWidth: '440px',
    width: '100%',
    justifySelf: 'center',
    boxSizing: 'border-box',
    [NARROW]: { ...shorthands.padding('24px', '24px', '40px') },
  },
  title: {
    fontSize: '40px',
    lineHeight: '48px',
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    ...shorthands.margin(0),
    [NARROW]: { fontSize: '32px', lineHeight: '40px' },
  },
  subtitle: {
    fontSize: tokens.fontSizeBase400,
    color: tokens.colorNeutralForeground2,
    marginTop: '4px',
  },
  form: { display: 'flex', flexDirection: 'column', ...shorthands.gap('18px') },
  input: { height: '40px' },
  forgot: {
    alignSelf: 'flex-start',
    color: tokens.colorBrandForegroundLink,
    fontSize: tokens.fontSizeBase300,
  },
  submit: {
    width: '100%',
    height: '40px',
    marginTop: '8px',
    backgroundColor: '#1F1F1F',
    ':hover': { backgroundColor: '#3A3A3A' },
    ':hover:active': { backgroundColor: '#000000' },
    ':disabled, :disabled:hover': {
      backgroundColor: tokens.colorNeutralBackgroundDisabled,
      color: tokens.colorNeutralForegroundDisabled,
    },
  },
  footer: {
    display: 'flex',
    justifyContent: 'center',
    paddingTop: '8px',
  },
  brandLogo: {
    height: '26px',
    width: 'auto',
    maxWidth: '100%',
    objectFit: 'contain',
    [NARROW]: { height: '22px' },
  },
});

function CornerBlob({ className }) {
  return (
    <svg className={className} viewBox="0 0 300 260" aria-hidden="true" focusable="false">
      <path
        fill="#DEE2EB"
        d="M58 70C70 30 120 18 150 40c20-30 75-28 90 10 35 5 52 45 30 75 20 35-8 80-48 75-17 38-72 45-94 15-33 23-83 10-80-30-38-10-43-65-10-77-13-16 2-36 20-38z"
      />
      {/* Small motion strokes, as drawn around the figures in the illustration. */}
      <g fill="none" strokeLinecap="round" strokeWidth="3.5">
        <path d="M30 196l-9 6" stroke="#1F2A44" />
        <path d="M38 210l-11 1" stroke="#1F2A44" />
        <path d="M40 224l-9 3" stroke="#EE8B3A" />
      </g>
    </svg>
  );
}

export default function LoginPage() {
  const styles = useStyles();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login } = useAuth();
  const [email, setEmail] = useState(() => getStoredLoginEmail());
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const reasonMessage = getLoginReasonMessage(searchParams.get('reason'));

  const handleEmailChange = useCallback((_, data) => setEmail(data.value), []);
  const handlePasswordChange = useCallback((_, data) => setPassword(data.value), []);
  const togglePassword = useCallback(() => setShowPassword((v) => !v), []);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const loginEmail = email.trim();
    try {
      const result = await login(loginEmail, password);
      storeLoginEmail(loginEmail);
      if (result.requiresPasswordSetup) {
        navigate('/set-password?email=' + encodeURIComponent(loginEmail));
      } else if (result.requiresMfa) {
        navigate('/mfa');
      } else {
        navigate('/');
      }
    } catch (err) {
      setError(err.message || 'Sign-in failed. Check your credentials.');
    } finally {
      setLoading(false);
    }
  }, [email, password, login, navigate]);

  return (
    <div className={styles.container}>
      <div className={styles.loginCard}>
        <CornerBlob className={styles.blob} />

        <div className={styles.visual}>
          <img
            src="/login-illustration.png"
            alt={APP_DISPLAY_NAME + ' illustration'}
            className={styles.illustration}
          />
        </div>

        <div className={styles.formPanel}>
          <div>
            <Text as="h1" className={styles.title} block>Sign in</Text>
            <Text className={styles.subtitle} block>{APP_DISPLAY_NAME}</Text>
          </div>

          {reasonMessage && !error && (
            <MessageBar intent="warning">
              <MessageBarBody>{reasonMessage}</MessageBarBody>
            </MessageBar>
          )}

          {error && (
            <MessageBar intent="error">
              <MessageBarBody>{error}</MessageBarBody>
            </MessageBar>
          )}

          <form className={styles.form} onSubmit={handleSubmit} autoComplete="on">
            <Field label="Email address" required>
              <Input
                id="login-email"
                name="email"
                type="email"
                className={styles.input}
                value={email}
                onChange={handleEmailChange}
                autoComplete="email"
                disabled={loading}
              />
            </Field>
            <Field label="Password" required>
              <Input
                id="login-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                className={styles.input}
                value={password}
                onChange={handlePasswordChange}
                autoComplete="current-password"
                disabled={loading}
                contentAfter={(
                  <Button
                    appearance="transparent"
                    size="small"
                    icon={showPassword ? <EyeOff20Regular /> : <Eye20Regular />}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    onClick={togglePassword}
                    disabled={loading}
                  />
                )}
              />
            </Field>

            <Link to="/forgot-password" className={styles.forgot}>Forgot password?</Link>

            <Button
              appearance="primary"
              type="submit"
              className={styles.submit}
              disabled={loading || !email || !password}
              icon={loading ? <Spinner size="tiny" /> : null}
            >
              {loading ? 'Working...' : 'Sign in'}
            </Button>
          </form>

          <div className={styles.footer}>
            <img
              src="/floris-van-bommel-logo.png"
              alt="Floris van Bommel"
              className={styles.brandLogo}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
