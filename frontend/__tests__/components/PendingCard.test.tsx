/** The 1-tap confirmation card shown when an auto-imported slip arrives. */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { PendingCard } from '../../components/PendingCard';
import { tx } from '../test-data';

jest.mock('../../store/SettingsContext', () => {
  const { makeFormatter } = require('../../utils/currency');
  return { useMoney: () => ({ ...makeFormatter('THB'), setCurrency: jest.fn() }) };
});

const slip = () => tx({ id: 7, amount: 642.5, merchant_name: 'Tops Market', category: 'Groceries', transaction_date: '2026-10-07', status: 'pending' });

async function setup(overrides: { onConfirm?: jest.Mock; onDiscard?: jest.Mock } = {}) {
  const onConfirm = overrides.onConfirm ?? jest.fn().mockResolvedValue(undefined);
  const onDiscard = overrides.onDiscard ?? jest.fn().mockResolvedValue(undefined);
  await render(<PendingCard tx={slip()} onConfirm={onConfirm} onDiscard={onDiscard} />);
  return { onConfirm, onDiscard };
}

beforeEach(() => jest.clearAllMocks());

describe('PendingCard', () => {
  it('shows what the AI extracted: merchant, category, date and amount', async () => {
    await setup();
    expect(screen.getByText('Tops Market')).toBeOnTheScreen();
    expect(screen.getByText('Groceries')).toBeOnTheScreen();
    expect(screen.getByText('Oct 7')).toBeOnTheScreen();
    expect(screen.getByText('฿642.50')).toBeOnTheScreen();
  });

  it('confirms in one tap, sending no edits', async () => {
    const { onConfirm } = await setup();
    await fireEvent.press(screen.getByText('Confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(7, {});
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');
  });

  it('sends only the fields that were edited', async () => {
    const { onConfirm } = await setup();
    await fireEvent.press(screen.getByLabelText('Edit'));
    await fireEvent.changeText(screen.getByDisplayValue('642.5'), '700');
    await fireEvent.changeText(screen.getByDisplayValue('Tops Market'), '  Tops Supermarket ');
    await fireEvent.press(screen.getByText('Confirm'));
    expect(onConfirm).toHaveBeenCalledWith(7, { amount: 700, merchant_name: 'Tops Supermarket' });
  });

  it('accepts a decimal comma and rounds to cents', async () => {
    const { onConfirm } = await setup();
    await fireEvent.press(screen.getByLabelText('Edit'));
    await fireEvent.changeText(screen.getByDisplayValue('642.5'), '99,999');
    await fireEvent.press(screen.getByText('Confirm'));
    expect(onConfirm).toHaveBeenCalledWith(7, { amount: 100 });
  });

  it.each(['0', '', 'abc', '-5'])('will not confirm an invalid amount (%p)', async (bad) => {
    const { onConfirm } = await setup();
    await fireEvent.press(screen.getByLabelText('Edit'));
    await fireEvent.changeText(screen.getByDisplayValue('642.5'), bad);
    await fireEvent.press(screen.getByText('Confirm'));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('will not confirm with an empty merchant', async () => {
    const { onConfirm } = await setup();
    await fireEvent.press(screen.getByLabelText('Edit'));
    await fireEvent.changeText(screen.getByDisplayValue('Tops Market'), '   ');
    await fireEvent.press(screen.getByText('Confirm'));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('discards with the trash button', async () => {
    const { onDiscard, onConfirm } = await setup();
    await fireEvent.press(screen.getByLabelText('Discard'));
    expect(onDiscard).toHaveBeenCalledWith(7);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('tells the user when saving fails, and lets them retry', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const onConfirm = jest.fn().mockRejectedValueOnce(new Error('Cannot reach the server')).mockResolvedValueOnce(undefined);
    await setup({ onConfirm });

    await fireEvent.press(screen.getByText('Confirm'));
    expect(alert).toHaveBeenCalledWith('Could not save', 'Cannot reach the server');

    await fireEvent.press(screen.getByText('Confirm')); // the button comes back after a failure
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });

  it('changes the category through the picker', async () => {
    const { onConfirm } = await setup();
    await fireEvent.press(screen.getByText('Groceries')); // the badge opens the picker
    expect(await screen.findByText('Transport')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Transport'));
    await fireEvent.press(screen.getByText('Confirm'));
    expect(onConfirm).toHaveBeenCalledWith(7, { category: 'Transport' });
  });
});
