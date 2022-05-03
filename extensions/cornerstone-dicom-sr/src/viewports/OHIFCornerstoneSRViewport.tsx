import React, { useCallback, useContext, useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import OHIF, { utils } from '@ohif/core';
import DICOMSRDisplayTool from './../tools/DICOMSRDisplayTool';
import SRLengthTool from '../tools/annotationTools/SRLengthTool';
import { setTrackingUniqueIdentifiersForElement } from '../tools/modules/dicomSRModule';
import {
  Notification,
  ViewportActionBar,
  useViewportGrid,
  useViewportDialog,
} from '@ohif/ui';

const { formatDate } = utils;

const MEASUREMENT_TRACKING_EXTENSION_ID =
  '@ohif/extension-measurement-tracking';

const SR_TOOLGROUP_BASE_NAME = 'SRToolGroup';

function OHIFCornerstoneSRViewport(props) {
  const {
    children,
    dataSource,
    displaySets,
    viewportIndex,
    servicesManager,
    extensionManager,
  } = props;

  const { DisplaySetService, ToolGroupService } = servicesManager.services;

  // SR viewport will always have a single display set
  const srDisplaySet = displaySets[0];

  const [viewportGrid, viewportGridService] = useViewportGrid();
  const [viewportDialogState, viewportDialogApi] = useViewportDialog();
  const [measurementSelected, setMeasurementSelected] = useState(0);
  const [measurementCount, setMeasurementCount] = useState(1);
  const [activeImageDisplaySetData, setActiveImageDisplaySetData] = useState(
    null
  );
  const [
    referencedDisplaySetMetadata,
    setReferencedDisplaySetMetadata,
  ] = useState(null);
  const [isHydrated, setIsHydrated] = useState(srDisplaySet.isHydrated);
  const [element, setElement] = useState(null);
  const { viewports, activeViewportIndex } = viewportGrid;

  // Optional hook into tracking extension, if present.
  let trackedMeasurements;
  let sendTrackedMeasurementsEvent;

  const hasMeasurementTrackingExtension = extensionManager.registeredExtensionIds.includes(
    MEASUREMENT_TRACKING_EXTENSION_ID
  );

  // TODO: this is a hook that fails if we register/de-register
  if (hasMeasurementTrackingExtension) {
    const contextModule = extensionManager.getModuleEntry(
      '@ohif/extension-measurement-tracking.contextModule.TrackedMeasurementsContext'
    );

    const useTrackedMeasurements = () => useContext(contextModule.context);

    [
      trackedMeasurements,
      sendTrackedMeasurementsEvent,
    ] = useTrackedMeasurements();
  }

  /**
   * Store the tracking identifiers per viewport in order to be able to
   * show the SR measurements on the referenced image on the correct viewport,
   * when multiple viewports are used.
   */
  const setTrackingIdentifiers = useCallback(
    measurementSelected => {
      const { measurements } = srDisplaySet;

      setTrackingUniqueIdentifiersForElement(
        element,
        measurements.map(measurement => measurement.TrackingUniqueIdentifier),
        measurementSelected
      );
    },
    [element, measurementSelected, srDisplaySet]
  );

  /**
   * OnElementEnabled callback which is called after the cornerstone3DExtension
   * has enabled the element. Note: we delegate all the image rendering to
   * cornerstone3DExtension, so we don't need to do anything here regarding
   * the image rendering, element enabling etc.
   */
  const onElementEnabled = evt => {
    setElement(evt.detail.element);
  };

  const updateViewport = useCallback(
    newMeasurementSelected => {
      const {
        StudyInstanceUID,
        displaySetInstanceUID,
        sopClassUids,
      } = srDisplaySet;

      if (!StudyInstanceUID || !displaySetInstanceUID) {
        return;
      }

      if (sopClassUids && sopClassUids.length > 1) {
        // Todo: what happens if there are multiple SOP Classes? Why we are
        // not throwing an error?
        console.warn(
          'More than one SOPClassUID in the same series is not yet supported.'
        );
      }

      _getViewportReferencedDisplaySetData(
        srDisplaySet,
        newMeasurementSelected,
        DisplaySetService
      ).then(({ referencedDisplaySet, referencedDisplaySetMetadata }) => {
        setMeasurementSelected(newMeasurementSelected);
        setActiveImageDisplaySetData(referencedDisplaySet);
        setReferencedDisplaySetMetadata(referencedDisplaySetMetadata);

        if (
          referencedDisplaySet.displaySetInstanceUID ===
          activeImageDisplaySetData?.displaySetInstanceUID
        ) {
          const { measurements } = srDisplaySet;

          // it means that we have a new referenced display set, and the
          // imageIdIndex will handle it by updating the viewport, but if they
          // are the same we just need to use MeasurementService to jump to the
          // new measurement
          const utilityModule = extensionManager.getModuleEntry(
            '@ohif/extension-cornerstone-3d.utilityModule.common'
          );

          const { Cornerstone3DViewportService } = utilityModule.exports;
          const viewportInfo = Cornerstone3DViewportService.getViewportInfoByIndex(
            viewportIndex
          );

          const csViewport = Cornerstone3DViewportService.getCornerstone3DViewport(
            viewportInfo.getViewportId()
          );

          const imageIds = csViewport.getImageIds();

          const imageIdIndex = imageIds.indexOf(
            measurements[newMeasurementSelected].imageId
          );

          if (imageIdIndex !== -1) {
            csViewport.setImageIdIndex(imageIdIndex);
          }
        }
      });
    },
    [dataSource, srDisplaySet, activeImageDisplaySetData, viewportIndex]
  );

  const getCornerstone3DViewport = useCallback(() => {
    if (!activeImageDisplaySetData) {
      return null;
    }

    const { component: Component } = extensionManager.getModuleEntry(
      '@ohif/extension-cornerstone-3d.viewportModule.cornerstone-3d'
    );

    const { measurements } = srDisplaySet;
    const measurement = measurements[measurementSelected];

    if (!measurement) {
      return null;
    }

    return (
      <Component
        {...props}
        // should be passed second since we don't want SR displaySet to
        // override the activeImageDisplaySetData
        displaySets={[activeImageDisplaySetData]}
        viewportOptions={{
          toolGroupId: `${SR_TOOLGROUP_BASE_NAME}`,
        }}
        onElementEnabled={onElementEnabled}
        initialImageIdOrIndex={measurement.imageId}
      ></Component>
    );
  }, [activeImageDisplaySetData, viewportIndex, measurementSelected]);

  const onMeasurementChange = useCallback(
    direction => {
      let newMeasurementSelected = measurementSelected;

      if (direction === 'right') {
        newMeasurementSelected++;

        if (newMeasurementSelected >= measurementCount) {
          newMeasurementSelected = 0;
        }
      } else {
        newMeasurementSelected--;

        if (newMeasurementSelected < 0) {
          newMeasurementSelected = measurementCount - 1;
        }
      }

      setTrackingIdentifiers(newMeasurementSelected);
      updateViewport(newMeasurementSelected);
    },
    [
      measurementSelected,
      measurementCount,
      updateViewport,
      setTrackingIdentifiers,
    ]
  );

  /**
   Cleanup the SR viewport when the viewport is destroyed
   */
  useEffect(() => {
    const onDisplaySetsRemovedSubscription = DisplaySetService.subscribe(
      DisplaySetService.EVENTS.DISPLAY_SETS_REMOVED,
      ({ displaySetInstanceUIDs }) => {
        const activeViewport = viewports[activeViewportIndex];
        if (
          displaySetInstanceUIDs.includes(activeViewport.displaySetInstanceUID)
        ) {
          viewportGridService.setDisplaySetsForViewport({
            viewportIndex: activeViewportIndex,
            displaySetInstanceUIDs: [],
          });
        }
      }
    );

    return () => {
      onDisplaySetsRemovedSubscription.unsubscribe();
    };
  }, []);
  /**
   * Hook to update the tracking identifiers when the selected measurement changes or
   * the element changes
   */
  useEffect(() => {
    if (!element) {
      return;
    }
    setTrackingIdentifiers(measurementSelected);
  }, [measurementSelected, element, setTrackingIdentifiers]);

  /**
   * Loading the measurements from the SR viewport, which goes through the
   * isHydratable check, the outcome for the isHydrated state here is always FALSE
   * since we don't do the hydration here. Todo: can't we just set it as false? why
   * we are changing the state here? isHydrated is always false at this stage, and
   * if it is hydrated we don't event use the SR viewport.
   */
  useEffect(() => {
    if (!srDisplaySet.isLoaded) {
      srDisplaySet.load();
    }
    setIsHydrated(srDisplaySet.isHydrated);

    const numMeasurements = srDisplaySet.measurements.length;
    setMeasurementCount(numMeasurements);
  }, [srDisplaySet]);

  /**
   * Todo: what is this, not sure what it does regarding the react aspect,
   * it is updating a local variable? which is not state.
   */
  let isLocked = trackedMeasurements?.context?.trackedSeries?.length > 0;
  useEffect(() => {
    isLocked = trackedMeasurements?.context?.trackedSeries?.length > 0;
  }, [trackedMeasurements]);

  /**
   * Data fetching for the SR displaySet, which updates the measurements and
   * also gets the referenced image displaySet that SR is based on.
   */
  useEffect(() => {
    updateViewport(measurementSelected);
  }, [dataSource, srDisplaySet]);

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  let childrenWithProps = null;

  if (!activeImageDisplaySetData || !referencedDisplaySetMetadata) {
    return null;
  }

  if (children && children.length) {
    childrenWithProps = children.map((child, index) => {
      return (
        child &&
        React.cloneElement(child, {
          viewportIndex,
          key: index,
        })
      );
    });
  }

  const { Modality } = srDisplaySet;

  const {
    PatientID,
    PatientName,
    PatientSex,
    PatientAge,
    SliceThickness,
    ManufacturerModelName,
    StudyDate,
    SeriesDescription,
    SpacingBetweenSlices,
    SeriesNumber,
  } = referencedDisplaySetMetadata;

  const label = viewports.length > 1 ? _viewportLabels[viewportIndex] : '';

  // TODO -> disabled double click for now: onDoubleClick={_onDoubleClick}
  return (
    <>
      <ViewportActionBar
        onDoubleClick={evt => {
          evt.stopPropagation();
          evt.preventDefault();
        }}
        onPillClick={() => {
          sendTrackedMeasurementsEvent('RESTORE_PROMPT_HYDRATE_SR', {
            displaySetInstanceUID: srDisplaySet.displaySetInstanceUID,
            viewportIndex,
          });
        }}
        onSeriesChange={onMeasurementChange}
        studyData={{
          label,
          useAltStyling: true,
          isTracked: false,
          isLocked,
          isRehydratable: srDisplaySet.isRehydratable,
          isHydrated,
          studyDate: formatDate(StudyDate),
          currentSeries: SeriesNumber,
          seriesDescription: 'sr viewport',
          modality: Modality,
          patientInformation: {
            patientName: PatientName
              ? OHIF.utils.formatPN(PatientName.Alphabetic)
              : '',
            patientSex: PatientSex || '',
            patientAge: PatientAge || '',
            MRN: PatientID || '',
            thickness: SliceThickness ? `${SliceThickness.toFixed(2)}mm` : '',
            spacing:
              SpacingBetweenSlices !== undefined
                ? `${SpacingBetweenSlices.toFixed(2)}mm`
                : '',
            scanner: ManufacturerModelName || '',
          },
        }}
      />

      <div className="relative flex flex-row w-full h-full overflow-hidden">
        {getCornerstone3DViewport()}
        <div className="absolute w-full">
          {viewportDialogState.viewportIndex === viewportIndex && (
            <Notification
              message={viewportDialogState.message}
              type={viewportDialogState.type}
              actions={viewportDialogState.actions}
              onSubmit={viewportDialogState.onSubmit}
              onOutsideClick={viewportDialogState.onOutsideClick}
            />
          )}
        </div>
        {childrenWithProps}
      </div>
    </>
  );
}

const _viewportLabels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];

OHIFCornerstoneSRViewport.propTypes = {
  displaySets: PropTypes.arrayOf(PropTypes.object),
  viewportIndex: PropTypes.number.isRequired,
  dataSource: PropTypes.object,
  children: PropTypes.node,
  customProps: PropTypes.object,
};

OHIFCornerstoneSRViewport.defaultProps = {
  customProps: {},
};

async function _getViewportReferencedDisplaySetData(
  displaySet,
  measurementSelected,
  DisplaySetService
) {
  const { measurements } = displaySet;
  const measurement = measurements[measurementSelected];

  const { displaySetInstanceUID } = measurement;

  const referencedDisplaySet = DisplaySetService.getDisplaySetByUID(
    displaySetInstanceUID
  );

  const image0 = referencedDisplaySet.images[0];
  const referencedDisplaySetMetadata = {
    PatientID: image0.PatientID,
    PatientName: image0.PatientName,
    PatientSex: image0.PatientSex,
    PatientAge: image0.PatientAge,
    SliceThickness: image0.SliceThickness,
    StudyDate: image0.StudyDate,
    SeriesDescription: image0.SeriesDescription,
    SeriesInstanceUID: image0.SeriesInstanceUID,
    SeriesNumber: image0.SeriesNumber,
    ManufacturerModelName: image0.ManufacturerModelName,
    SpacingBetweenSlices: image0.SpacingBetweenSlices,
  };

  return { referencedDisplaySetMetadata, referencedDisplaySet };
}

// function _onDoubleClick() {
//   const cancelActiveManipulatorsForElement = cornerstoneTools.getModule(
//     'manipulatorState'
//   ).setters.cancelActiveManipulatorsForElement;
//   const enabledElements = cornerstoneTools.store.state.enabledElements;
//   enabledElements.forEach(element => {
//     cancelActiveManipulatorsForElement(element);
//   });
// }

export default OHIFCornerstoneSRViewport;