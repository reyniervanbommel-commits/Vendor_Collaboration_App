import React, { useCallback, useState } from 'react';
import {
  MessageBar,
  MessageBarBody,
  Spinner,
  Tab,
  TabList,
  Text,
  makeStyles,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import SyncFilterBuilder from './SyncFilterBuilder';
import DataPreviewTables from './DataPreviewTables';
import AdminInfoHint from './AdminInfoHint';
import { DATA_MODEL_INFO } from './dataModelInfoCopy';
import { useDataModelAdmin } from '../../../hooks/useDataModelAdmin';
import { useProductAttributeBoardColumns } from '../../../hooks/useProductAttributeBoardColumns';
import ProductAttributeBoardColumnsPanel from './ProductAttributeBoardColumnsPanel';

const useStyles = makeStyles({
  root: { width: '100%', maxWidth: 'none', display: 'flex', flexDirection: 'column', ...shorthands.gap('20px') },
  intro: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  titleRow: { display: 'flex', alignItems: 'center', ...shorthands.gap('4px') },
  error: { color: tokens.colorPaletteRedForeground1 },
  info: { marginTop: '4px' },
});

/**
 * Admin tab "Data model": configureer kolommen en syncfilters per entiteit (PO, vendors, items).
 */
function formatDiscoveryMessage(discovery) {
  if (!discovery) return '';
  const headerAdded = Number(discovery.headerInserted) || 0;
  const lineAdded = Number(discovery.lineInserted) || 0;
  const headerRemoved = Number(discovery.headerRemoved) || 0;
  const lineRemoved = Number(discovery.lineRemoved) || 0;
  const totalAdded = headerAdded + lineAdded;
  const totalRemoved = headerRemoved + lineRemoved;
  if (!totalAdded && !totalRemoved) return '';
  const parts = [];
  if (headerAdded) parts.push(`${headerAdded} header`);
  if (lineAdded) parts.push(`${lineAdded} line`);
  const added = totalAdded
    ? `Added ${parts.join(' and ')} column${totalAdded === 1 ? '' : 's'} from D365 (hidden by default).`
    : '';
  const removed = totalRemoved
    ? `Removed ${totalRemoved} column${totalRemoved === 1 ? '' : 's'} that D365 no longer exposes.`
    : '';
  const hint = totalAdded ? ' Turn on "Visible in table" to use new columns on the board.' : '';
  return `${added}${added && removed ? ' ' : ''}${removed}${hint}`.trim();
}

export default function AdminDataModel() {
  const styles = useStyles();
  const [selectedTab, setSelectedTab] = useState('purchase-orders');
  const purchaseOrders = useDataModelAdmin('purchase-orders');
  const vendors = useDataModelAdmin('vendors');
  const items = useDataModelAdmin('items');
  const productReceiptLines = useDataModelAdmin('product-receipt-lines');
  const productAttributeValues = useDataModelAdmin('product-attribute-values');
  const pavBoardColumns = useProductAttributeBoardColumns(
    selectedTab === 'product-attribute-values',
  );
  const modelByTab = {
    'purchase-orders': purchaseOrders,
    vendors,
    items,
    'product-receipt-lines': productReceiptLines,
    'product-attribute-values': productAttributeValues,
  };
  const selectedModel = modelByTab[selectedTab];
  const discoveryMessage = formatDiscoveryMessage(selectedModel?.discovery);
  const handleTabSelect = useCallback((_, data) => {
    setSelectedTab(data.value);
  }, []);

  return (
    <div className={styles.root}>
      <div>
        <div className={styles.titleRow}>
          <Text size={600} weight="semibold">Data model</Text>
          <AdminInfoHint text={DATA_MODEL_INFO.page} label="About the data model page" />
        </div>
        <Text className={styles.intro} block>
          Configure columns and sync filters per D365 entity.
        </Text>
      </div>

      <TabList selectedValue={selectedTab} onTabSelect={handleTabSelect}>
        <Tab value="purchase-orders">Purchase orders</Tab>
        <Tab value="vendors">Vendors</Tab>
        <Tab value="items">Items</Tab>
        <Tab value="product-receipt-lines">Product receipt lines</Tab>
        <Tab value="product-attribute-values">Product attribute values</Tab>
      </TabList>

      {selectedModel.loading ? (
        <Spinner label="Loading data model..." />
      ) : (
        <>
          {selectedModel.error ? <Text className={styles.error} block>{selectedModel.error}</Text> : null}
          {discoveryMessage ? (
            <MessageBar intent="info" className={styles.info}>
              <MessageBarBody>{discoveryMessage}</MessageBarBody>
            </MessageBar>
          ) : null}
          <SyncFilterBuilder
            tableKey={selectedTab}
            filterCatalog={selectedModel.filterCatalog}
            syncFilter={selectedModel.syncFilter}
            cache={selectedModel.cache}
            onReimportBaseline={selectedModel.reimportBaseline}
            baselineBusy={selectedModel.togglingKey === 'baseline-import'}
            onSyncFiltersSaved={selectedModel.reload}
          />
          <DataPreviewTables
            tableKey={selectedTab}
            entities={selectedModel.entities}
            previewTables={selectedModel.previewTables}
            columns={selectedModel.columns}
            relation={selectedModel.relation}
            togglingKey={selectedModel.togglingKey}
            onToggleVisibility={selectedModel.toggleVisibility}
            onToggleVisibleAtDelete={selectedModel.toggleVisibleAtDelete}
            onToggleWriteback={selectedModel.toggleWriteback}
            onToggleVendorEditable={selectedModel.toggleVendorEditable}
            onSetColumnToggleState={selectedModel.setColumnToggleState}
            onDeleteColumn={selectedModel.deleteColumn}
            onDiscoverFields={selectedModel.discoverFields}
          />
          {selectedTab === 'product-attribute-values' ? (
            <ProductAttributeBoardColumnsPanel
              names={pavBoardColumns.names}
              loading={pavBoardColumns.loading}
              error={pavBoardColumns.error}
              togglingName={pavBoardColumns.togglingName}
              onSetVisible={pavBoardColumns.setVisible}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
