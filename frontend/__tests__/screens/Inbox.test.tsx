/** The Inbox: auto-import status, the 1-tap confirmation cards, clipboard paste and manual entry. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { Alert, Linking } from 'react-native';
import Inbox from '../../app/(tabs)/add';
import { useAutoImport } from '../../store/AutoImportContext';
import { useTransactions } from '../../store/TransactionsContext';
import { todayISO } from '../../utils/format';
import { tx } from '../test-data';

jest.mock('../../services/api');
jest.mock('../../store/TransactionsContext');
jest.mock('../../store/AutoImportContext', () => ({ useAutoImport: jest.fn() }));
jest.mock('expo-clipboard', () => ({ getImageAsync: jest.fn(), isPasteButtonAvailable: false }));
jest.mock('../../store/SettingsContext', () => {
  const { makeFormatter } = require('../../utils/currency');
  return { useMoney: () => ({ ...makeFormatter('THB'), setCurrency: jest.fn() }) };
});

const useTransactionsMock = useTransactions as jest.MockedFunction<typeof useTransactions>;
const useAutoImportMock = useAutoImport as jest.MockedFunction<typeof useAutoImport>;
const router = () => require('expo-router').useRouter();

const actions = {
  refreshPending: jest.fn(),
  confirmPending: jest.fn().mockResolvedValue(undefined),
  discardPending: jest.fn().mockResolvedValue(undefined),
  saveTransaction: jest.fn().mockResolvedValue(undefined),
};
const auto = { enable: jest.fn(), disable: jest.fn(), scanNow: jest.fn(), importImage: jest.fn().mockResolvedValue(true) };

function setup(opts: { pending?: ReturnType<typeof tx>[]; auto?: Partial<ReturnType<typeof useAutoImport>> } = {}) {
  useTransactionsMock.mockReturnValue({
    transactions: [], pending: opts.pending ?? [], advice: null, budgets: [], notice: null, summary: null, loading: false, error: null,
    refresh: jest.fn(), dismissNotice: jest.fn(), ...actions,
  } as unknown as ReturnType<typeof useTransactions>);
  useAutoImportMock.mockReturnValue({
    access: 'all', watching: true, importing: 0, error: null, lastScanAt: Date.now(), ...auto, ...opts.auto,
  } as ReturnType<typeof useAutoImport>);
}

const pending = () => [
  tx({ id: 11, merchant_name: 'Tops Market', amount: 642.5, category: 'Groceries', status: 'pending' }),
  tx({ id: 12, merchant_name: 'Grab', amount: 185, category: 'Transport', status: 'pending' }),
];

beforeEach(() => jest.clearAllMocks());

describe('Inbox: reviewing auto-imported slips', () => {
  it('lists every waiting slip as a confirmation card', async () => {
    setup({ pending: pending() });
    await render(<Inbox />);
    expect(screen.getByText('Inbox')).toBeOnTheScreen();
    expect(screen.getByText('To review · 2')).toBeOnTheScreen();
    expect(screen.getByText('Tops Market')).toBeOnTheScreen();
    expect(screen.getByText('฿642.50')).toBeOnTheScreen();
    expect(screen.getByText('Grab')).toBeOnTheScreen();
    expect(screen.getAllByText('Confirm')).toHaveLength(2);
  });

  it('confirms a slip with one tap', async () => {
    setup({ pending: pending() });
    await render(<Inbox />);
    await fireEvent.press(screen.getAllByText('Confirm')[0]);
    expect(actions.confirmPending).toHaveBeenCalledWith(11, {});
  });

  it('discards a slip', async () => {
    setup({ pending: pending() });
    await render(<Inbox />);
    await fireEvent.press(screen.getAllByLabelText('Discard')[1]);
    expect(actions.discardPending).toHaveBeenCalledWith(12);
  });

  it('refreshes the list and rescans for screenshots whenever it is opened', async () => {
    setup();
    await render(<Inbox />);
    expect(actions.refreshPending).toHaveBeenCalled();
    expect(auto.scanNow).toHaveBeenCalled();
  });

  it('shows "All caught up" when nothing is waiting', async () => {
    setup();
    await render(<Inbox />);
    expect(screen.getByText('All caught up')).toBeOnTheScreen();
    expect(screen.queryByText(/To review/)).toBeNull();
  });

  it('shows a skeleton card while a slip is being read', async () => {
    setup({ auto: { importing: 1 } });
    await render(<Inbox />);
    expect(screen.getByText('Reading receipt…')).toBeOnTheScreen();
    expect(screen.getByText('To review')).toBeOnTheScreen();
    expect(screen.queryByText('All caught up')).toBeNull();
  });
});

describe('Inbox: auto-import status', () => {
  it('shows that screenshots are being watched', async () => {
    setup();
    await render(<Inbox />);
    expect(screen.getByText('Watching for screenshots')).toBeOnTheScreen();
    expect(screen.getByText('Checked just now')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Turn off'));
    expect(auto.disable).toHaveBeenCalled();
  });

  it('asks permission before watching anything', async () => {
    setup({ auto: { access: 'undetermined', watching: false } });
    await render(<Inbox />);
    expect(screen.getByText('Auto-import screenshots')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Turn on'));
    expect(auto.enable).toHaveBeenCalled();
  });

  it('sends the user to Settings when Photos access was denied', async () => {
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    setup({ auto: { access: 'none', watching: false } });
    await render(<Inbox />);
    expect(screen.getByText('Photo access is off')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Open Settings'));
    expect(open).toHaveBeenCalled();
  });

  it('surfaces import problems without hiding the screen', async () => {
    setup({ auto: { error: 'Cannot reach the server at http://localhost:8000. Is the backend running?' } });
    await render(<Inbox />);
    expect(screen.getByText('Auto-import needs attention')).toBeOnTheScreen();
    expect(screen.getByText(/Cannot reach the server/)).toBeOnTheScreen();
  });
});

describe('Inbox: clipboard and manual entry', () => {
  it('imports an image from the clipboard', async () => {
    (Clipboard.getImageAsync as jest.Mock).mockResolvedValue({ data: 'data:image/png;base64,AQID' });
    setup();
    await render(<Inbox />);
    await fireEvent.press(screen.getByText('Paste'));
    await waitFor(() => expect(auto.importImage).toHaveBeenCalledWith('data:image/png;base64,AQID'));
  });

  it('explains when the clipboard has no image', async () => {
    (Clipboard.getImageAsync as jest.Mock).mockResolvedValue(null);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    setup();
    await render(<Inbox />);
    await fireEvent.press(screen.getByText('Paste'));
    await waitFor(() => expect(alert).toHaveBeenCalledWith('No image on the clipboard', expect.any(String)));
    expect(auto.importImage).not.toHaveBeenCalled();
  });

  it('saves a manually entered slip and returns to the dashboard', async () => {
    setup();
    await render(<Inbox />);
    await fireEvent.press(screen.getByText('Add manually'));
    await fireEvent.changeText(screen.getByPlaceholderText('0.00'), '120,5');
    await fireEvent.changeText(screen.getByPlaceholderText('Merchant'), '  Corner Shop ');
    await fireEvent.press(screen.getByText('Save'));

    await waitFor(() =>
      expect(actions.saveTransaction).toHaveBeenCalledWith({ amount: 120.5, merchant_name: 'Corner Shop', category: 'Other', transaction_date: todayISO() }),
    );
    expect(router().navigate).toHaveBeenCalledWith('/');
  });

  it('will not save a manual slip without an amount and merchant', async () => {
    setup();
    await render(<Inbox />);
    await fireEvent.press(screen.getByText('Add manually'));
    await fireEvent.press(screen.getByText('Save'));
    expect(actions.saveTransaction).not.toHaveBeenCalled();
  });
});
