/** Editing and deleting a saved slip from the sheet that opens when you tap it. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { SlipEditorSheet } from '../../components/SlipEditorSheet';
import { tx } from '../test-data';

jest.mock('../../store/SettingsContext', () => {
  const { makeFormatter } = require('../../utils/currency');
  return { useMoney: () => ({ ...makeFormatter('THB'), setCurrency: jest.fn() }) };
});

const slip = () => tx({ id: 21, amount: 520, merchant_name: 'Som Tam Nua', category: 'Food', transaction_date: '2026-10-05' });

async function setup(overrides: { onSave?: jest.Mock; onDelete?: jest.Mock } = {}) {
  const onSave = overrides.onSave ?? jest.fn().mockResolvedValue(undefined);
  const onDelete = overrides.onDelete ?? jest.fn().mockResolvedValue(undefined);
  const onClose = jest.fn();
  await render(<SlipEditorSheet tx={slip()} onClose={onClose} onSave={onSave} onDelete={onDelete} />);
  return { onSave, onDelete, onClose };
}

beforeEach(() => jest.clearAllMocks());

describe('SlipEditorSheet', () => {
  it('opens with the slip\'s current values', async () => {
    await setup();
    expect(screen.getByText('Edit slip')).toBeOnTheScreen();
    expect(screen.getByDisplayValue('520')).toBeOnTheScreen();
    expect(screen.getByDisplayValue('Som Tam Nua')).toBeOnTheScreen();
    expect(screen.getByText('Delete slip')).toBeOnTheScreen();
  });

  it('shows nothing when no slip is selected', async () => {
    await render(<SlipEditorSheet tx={null} onClose={jest.fn()} onSave={jest.fn()} onDelete={jest.fn()} />);
    expect(screen.queryByText('Edit slip')).toBeNull();
  });

  it('will not save until something has changed', async () => {
    const { onSave } = await setup();
    await fireEvent.press(screen.getByText('Save changes'));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves only the fields that changed, then closes', async () => {
    const { onSave, onClose } = await setup();
    await fireEvent.changeText(screen.getByLabelText('Amount'), '450,5');
    await fireEvent.changeText(screen.getByLabelText('Merchant'), '  Som Tam Nua Thonglor ');
    await fireEvent.press(screen.getByText('Save changes'));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(21, { amount: 450.5, merchant_name: 'Som Tam Nua Thonglor' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('changes the category with the chips', async () => {
    const { onSave } = await setup();
    await fireEvent.press(screen.getByText('Transport'));
    await fireEvent.press(screen.getByText('Save changes'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(21, { category: 'Transport' }));
  });

  it.each(['0', '', 'abc', '-3'])('blocks saving an invalid amount (%p)', async (bad) => {
    const { onSave } = await setup();
    await fireEvent.changeText(screen.getByLabelText('Amount'), bad);
    await fireEvent.press(screen.getByText('Save changes'));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('blocks saving an empty merchant', async () => {
    const { onSave } = await setup();
    await fireEvent.changeText(screen.getByLabelText('Merchant'), '   ');
    await fireEvent.press(screen.getByText('Save changes'));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('keeps the sheet open and tells you when saving fails', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { onClose } = await setup({ onSave: jest.fn().mockRejectedValue(new Error('Cannot reach the server')) });
    await fireEvent.changeText(screen.getByLabelText('Amount'), '600');
    await fireEvent.press(screen.getByText('Save changes'));
    await waitFor(() => expect(alert).toHaveBeenCalledWith('Could not save changes', 'Cannot reach the server'));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('SlipEditorSheet: deleting', () => {
  function pressAlertButton(alert: jest.SpyInstance, label: string) {
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    buttons.find((b) => b.text === label)!.onPress?.();
  }

  it('asks for confirmation first', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { onDelete } = await setup();
    await fireEvent.press(screen.getByText('Delete slip'));
    expect(alert).toHaveBeenCalledWith('Delete this slip?', expect.stringContaining('Som Tam Nua'), expect.any(Array));
    expect(onDelete).not.toHaveBeenCalled(); // nothing happens until you confirm
  });

  it('deletes and closes once confirmed', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { onDelete, onClose } = await setup();
    await fireEvent.press(screen.getByText('Delete slip'));
    pressAlertButton(alert, 'Delete');
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(21));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('does nothing when you cancel', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { onDelete, onClose } = await setup();
    await fireEvent.press(screen.getByText('Delete slip'));
    pressAlertButton(alert, 'Cancel');
    expect(onDelete).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('reports a failed delete and stays open', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { onClose } = await setup({ onDelete: jest.fn().mockRejectedValue(new Error('Transaction not found')) });
    await fireEvent.press(screen.getByText('Delete slip'));
    pressAlertButton(alert, 'Delete');
    await waitFor(() => expect(alert).toHaveBeenCalledWith('Could not delete', 'Transaction not found'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
